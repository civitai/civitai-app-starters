import type { JSONValue, ModelMessage, ToolResultPart } from 'ai';
import { ulid } from 'ulid';

import type { AgentErrorDetail, AgentRetryDetail } from '../agent/agent.js';
import type { ChatAgent } from '../agent/chat-agent.js';
import type { LiveTurn } from '../agent/core.js';
import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import { DISPATCH_AGENT, isSubagentOutput, SUBAGENT_KIND, type SubagentResult } from '../agent/subagent-result.js';
import type { ErrorTrace } from '../agent/error-trace.js';
import {
  applyRunEvent,
  RUN_FEATURE_EDIT,
  RUN_KEEPALIVE_MS,
  RUN_PROTOCOL_VERSION,
  type RunEvent,
  type RunErrorCode,
  type RunPageState,
  type RunSettings,
  type RunSubagentProgress,
  type StartRunRequest,
} from '../runner-protocol.js';
import type { ConversationStore } from '../store/conversation-store.js';
import { CUT_OFF, editTurn } from '../store/thread-store.js';
import type { ChatToolResult } from '../tools/gate.js';
import type { Attachment, Turn } from '../types.js';
import type { ErrorKind } from '../ux/humanize.js';
import { RECONNECT_DELAYS_MS, RunnerClient, RunnerHttpError, unanswered } from './runner-client.js';
import { readSse, type SseMessage } from './sse.js';

/** An event stream that sent nothing (not even its keep-alive comment) for this long is taken as dead and opened again. */
export const RUN_IDLE_MS = 3 * RUN_KEEPALIVE_MS;

/**
 * An event stream that sent nothing for this long has missed a keep-alive: the reply's status line says
 * it is reconnecting (the stream is left open, and taken as dead only at {@link RUN_IDLE_MS}).
 */
export const RUN_QUIET_MS = RUN_KEEPALIVE_MS + 5_000;

/** The longest the agent stays `running` while the chat's head is read again after a run: a read that hangs lets go then. */
export const REREAD_TIMEOUT_MS = 15_000;

/** Run events that do not show the run moving on after a model retry (see `#apply`). */
const NOT_PROGRESS: ReadonlySet<string> = new Set(['network-retry', 'error', 'parts-truncate', 'run-started']);

/** What a turn shows when its run could no longer be found and its chat could not be read again. */
export const RUN_LOST = 'Lost track of this reply. Open the chat again to see how it ended.';

/**
 * What a reply ended on the page (Stop refused or not answered in time, the viewer refused, the run
 * lost) shows for a call whose result never reached it: the call may well have finished on the runner.
 */
export const RESULT_NOT_RECEIVED = "This call's result wasn't received here. It may have finished; reload to see it.";

/** What a turn shows when the runner refuses the viewer on the run's events (401/403): the run itself goes on. */
export const RUN_DENIED = "The assistant's server did not accept your sign-in, so this reply cannot be followed here. Reload the page to see it.";

/** How long after Stop the reply waits for the run to say it stopped before it ends on the page anyway (the stop is still sent). */
export const STOP_GRACE_MS = 10_000;

/** The most times a stop that had no answer is sent again, at the reconnect waits, after the reply ended on the page. */
export const STOP_ATTEMPTS = 20;

/**
 * How long a start that keeps failing with no answer, or with the runner down for now (5xx, 408, 429),
 * is asked again: no ask is made later than this after the first (or after the page last woke, so
 * time it spent asleep does not count). On the reconnect waits (1, 2, 5, 10, 30 s) that is the ladder
 * once, six asks over 48 s; a start whose asks hang until the request timeout stops after fewer asks,
 * and at most one timeout past this. Past it the turn fails with Retry, which asks again with the
 * same idempotency key: a spinner that never ends tells the viewer nothing.
 */
export const START_GIVE_UP_MS = 60_000;

/** What a turn shows when its start was asked again for {@link START_GIVE_UP_MS} and no answer started it. */
export const START_GAVE_UP = "Couldn't start the reply right now. Try again in a minute.";

/** What a turn shows when the chat already had a reply running (from another tab or device). */
export const RUN_ACTIVE = 'Another reply is still running in this chat. Wait for it to finish, then send again.';

export interface RemoteAgentDeps {
  client: RunnerClient;
  store: ConversationStore;
  scope?: string;
  /** The model the next reply uses, read as it starts. */
  model(): string;
  settings(): RunSettings;
  pageState?(): RunPageState | undefined;
  /** Reads the chat's head again (the runner wrote it) once a run ended: the session's `reloadConversation`. */
  reread(conversationId: string): Promise<void>;
  /** The session's subagent cards. */
  progress?: { set(id: string, progress: RunSubagentProgress | undefined): void; get?(id: string): RunSubagentProgress | undefined };
  /** A tool call finished, as the runner's gate reported it. */
  onToolResult?(result: ChatToolResult): void;
  /** Calls `listener` whenever the page wakes (shown again, back online, restored); returns how to stop. */
  wake?(listener: () => void): () => void;
  newKey?(): string;
  idleMs?: number;
  /** {@link RUN_QUIET_MS} unless set. */
  quietMs?: number;
  /** {@link STOP_GRACE_MS} unless set. */
  stopGraceMs?: number;
}

interface Run {
  conversationId: string;
  turn: Turn;
  runId?: string;
  /** The start's idempotency key: Stop before the run id is known stops the run by it. */
  key?: string;
  /** The id of the latest event applied: a reconnect resumes after it. */
  lastEventId?: string;
  stopRequested: boolean;
  /** Ended, or left: nothing more is done for it here. */
  closed: boolean;
  error?: Extract<RunEvent, { type: 'error' }>;
  connection?: AbortController;
  /** Set when the connection is closed to be opened again at once (`wake`), not after a wait. */
  reconnectNow?: boolean;
  lastMessageAt: number;
  /**
   * The highest event id announced to the page (tool reports, retries): a replay does not announce
   * them again. Following a run again after a reload starts at the latest id the lookup reported.
   */
  firedThrough?: number;
  /** The highest event id whose state (the turn's retries) this run took in: a journal read again does not take it twice. */
  appliedThrough?: number;
  /** Journal re-reads in a row (an event that did not fit), for their waits: not reset by the events that do fit. */
  resyncs: number;
  /** The calls whose result never reached the page, when the reply ended on the page: a head's real result for one of them is more than the page has. */
  unreceived?: Set<string>;
  /** Ends the wait before the next reconnect, while one waits. */
  wakeWait?: () => void;
  /** While its start has had no answer: since when it has been asked, for {@link START_GIVE_UP_MS} (the page waking starts it over). */
  askingSince?: number;
  /** The event stream is down: it dropped, went quiet past a keep-alive, or is being opened again. */
  streamDown?: boolean;
  /** The runner's own connection to the model was cut and the step is asked for again (`network-retry`), until the next part. */
  modelRetrying?: boolean;
  /** Fires once the open stream has been quiet for {@link RUN_QUIET_MS}. */
  quiet?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
}

/**
 * The reply's loop runs on a server runner (`runner: 'remote'`); this follows it. A reply starts as a
 * run (`POST /runs`), and its events build the same parts the page's own `Agent` shows, so the thread,
 * tool views, subagent cards and badges render as ever. The run carries on whatever the page does:
 * a dropped connection is opened again, resuming after the last event read (`Last-Event-ID`), for as
 * long as the run is live; opening the chat again (a reload, another device) finds it and follows it
 * from its start (`reattach`). Stop asks the runner to stop; the reply shows stopped once the run says
 * it ended. The page writes no head: the runner is the only writer, and the page reads the head again
 * once a run ended.
 */
export class RemoteAgent extends EventTarget implements ChatAgent {
  #deps: RemoteAgentDeps;
  #run: Run | undefined;
  #live: LiveTurn | null = null;
  /** The chat a lookup is in flight for, and the chat asked for while it was (the latest wins). */
  #attaching: string | undefined;
  #attachNext: string | undefined;
  /** Runs that ended here: a lookup that still names one (the runner had not let go of it yet) is not followed again. */
  #ended = new Set<string>();
  /** Bumped whenever the page leaves: a lookup that was on its way before starts nothing. */
  #generation = 0;
  /**
   * The turn the viewer edited whose start the runner has not taken yet (it was refused, or is on its
   * way): Retry of it asks for the edit again, since the runner's head still holds the old message.
   */
  #edited: Turn | undefined;
  #disposed = false;
  /**
   * The idempotency key of a turn's start given up on with no answer (`#gaveUp`): it may well have
   * started a run, so Retry asks with the same key, and a runner that started it answers with that run
   * instead of refusing a second one. Only the key: the rest of the start (model, settings, page, and
   * `retry`) is built afresh, as any Retry's is.
   */
  #unanswered = new WeakMap<Turn, string>();

  constructor(deps: RemoteAgentDeps) {
    super();
    this.#deps = deps;
  }

  get live(): LiveTurn | null {
    return this.#live;
  }

  get running(): boolean {
    return this.#run !== undefined;
  }

  async send(content: string, attachments: Attachment[] = [], refs: string[] = []): Promise<void> {
    if (this.running || this.#disposed) return;
    // In remote mode the store writes nothing: the turn is the page's until the runner saves it.
    const turn = this.#deps.store.appendUserTurn(content, attachments, refs);
    const conversation = this.#deps.store.current;
    if (!conversation) return;
    await this.#start(conversation.id, turn, false);
  }

  async retry(): Promise<void> {
    const conversation = this.#deps.store.current;
    const turn = conversation?.turns.at(-1);
    if (this.running || this.#disposed || !conversation || turn?.assistant.status !== 'error') return;
    const key = this.#unanswered.get(turn);
    this.#unanswered.delete(turn);
    turn.assistant = { messages: [], status: 'streaming' };
    await this.#start(conversation.id, turn, true, key);
  }

  /** Only once the runner said it takes edits (`features` on a start's or a lookup's answer): an older runner would reply to the old message. */
  get canEdit(): boolean {
    return this.#deps.client.features?.has(RUN_FEATURE_EDIT) ?? false;
  }

  /**
   * The viewer edited their latest message: the run starts with `edit`, so the runner replaces the
   * message in its head, drops the reply that followed it and replies afresh, as a new reply (charged
   * as one). The page writes nothing: it reads the head again once the run ended.
   */
  async edit(content: string): Promise<void> {
    const conversation = this.#deps.store.current;
    const turn = conversation?.turns.at(-1);
    if (this.running || this.#disposed || !this.canEdit || !conversation || !turn) return;
    const { store } = this.#deps;
    if (store.editUserTurn) store.editUserTurn(turn, content);
    else editTurn(conversation, turn, content, new Date().toISOString());
    this.#edited = turn;
    await this.#start(conversation.id, turn, false);
  }

  /**
   * The viewer's Stop: asks the runner to stop the run. The reply keeps showing until the run says it
   * ended, for at most {@link STOP_GRACE_MS}, and not at all once the runner refused the stop: then it
   * ends on the page as stopped, so the message box is free again whatever the runner does.
   */
  abort(): void {
    const run = this.#run;
    if (!run || run.closed || run.stopRequested) return;
    run.stopRequested = true;
    if (run.runId) {
      const runId = run.runId;
      void this.#stopRemotely(run.conversationId, () => this.#deps.client.stop(runId)).then((refused) => refused && this.#stoppedHere(run));
      setTimeout(() => this.#stoppedHere(run), this.#deps.stopGraceMs ?? STOP_GRACE_MS);
      return;
    }
    // No run id yet (its start has had no answer, but it may have reached the runner): the reply ends
    // here at once, and the run that start may have started is stopped by its key.
    run.turn.assistant.status = 'aborted';
    this.#close(run);
    const key = run.key!;
    void this.#stopRemotely(run.conversationId, () => this.#deps.client.stopByKey(key, run.conversationId));
  }

  /** Stops following the run, which carries on on the server; opening its chat again follows it again. */
  leave(): void {
    this.#generation++;
    if (this.#run) this.#close(this.#run);
  }

  /** The session is done with: nothing is followed, sent or looked up any more (a stop already on its way still goes). */
  dispose(): void {
    this.#disposed = true;
    this.leave();
  }

  /**
   * Looks for a live run of the open chat `conversationId` and follows it from its start, as the
   * reply of its turn: after a reload, or a chat opened on another device. Whether it found one.
   */
  async reattach(conversationId: string): Promise<boolean> {
    if (this.#run || this.#disposed) return false;
    const generation = this.#generation;
    if (this.#attaching !== undefined) {
      // One lookup at a time; the chat opened last is looked up once this one is answered.
      this.#attachNext = conversationId;
      return false;
    }
    this.#attaching = conversationId;
    try {
      const couldEdit = this.canEdit;
      const summary = await this.#deps.client.lookup(conversationId);
      // The runner's answer says whether it takes edits: the latest message's Edit shows or goes.
      if (this.canEdit !== couldEdit) this.#emit();
      const conversation = this.#deps.store.current;
      // The page left (another chat, a new one, the session replaced) while the lookup was on its way.
      if (generation !== this.#generation || this.#disposed) return false;
      if (!summary || this.#ended.has(summary.runId) || this.#run || conversation?.id !== conversationId) return false;
      let turn = conversation.turns.find((t) => t.seq === summary.seq);
      if (!turn) {
        // Started before the runner saved its turn: the turn is shown from what the runner says.
        if (summary.seq !== (conversation.turns.at(-1)?.seq ?? 0) + 1) return false;
        turn = this.#deps.store.appendUserTurn(summary.user.content, summary.user.attachments ?? [], summary.user.refs ?? []);
      }
      // Only the latest turn can be replying.
      if (turn !== conversation.turns.at(-1)) return false;
      turn.assistant = { messages: [], status: 'streaming' };
      const started = Date.parse(summary.startedAt);
      const run = this.#begin(conversationId, turn, { reattached: true, ...(Number.isFinite(started) ? { startedAt: started } : {}) });
      run.runId = summary.runId;
      // Everything up to now is rebuilt from the replay, but the page already heard of it: not announced again.
      const heard = Number(summary.lastEventId);
      if (summary.lastEventId !== undefined && Number.isFinite(heard)) run.firedThrough = heard;
      void this.#follow(run);
      return true;
    } catch (error) {
      console.warn('[chat-cvt] could not look for a reply still running', error);
      return false;
    } finally {
      this.#attaching = undefined;
      const next = this.#attachNext;
      this.#attachNext = undefined;
      // The chat asked for meanwhile; the same chat too when the page left it and came back while this lookup was on its way (its answer was dropped).
      const again = next !== undefined && (next !== conversationId || generation !== this.#generation);
      if (again && !this.#disposed && this.#deps.store.current?.id === next) void this.reattach(next);
    }
  }

  /**
   * The page woke: a reconnect waiting for its turn goes at once, and a connection that has been quiet
   * for longer than the runner's keep-alive (it may have died while the page slept) is opened again.
   */
  wake(): void {
    const run = this.#run;
    if (!run || run.closed) return;
    // A start still unanswered gets its minute again: the time the page slept was not spent asking.
    if (!run.runId) run.askingSince = Date.now();
    if (run.wakeWait) run.wakeWait();
    else if (run.connection && Date.now() - run.lastMessageAt > RUN_KEEPALIVE_MS) {
      run.reconnectNow = true;
      this.#down(run, { stream: true });
      run.connection.abort();
    }
  }

  #begin(conversationId: string, turn: Turn, live: Pick<LiveTurn, 'startedAt' | 'reattached'> = {}): Run {
    const run: Run = { conversationId, turn, stopRequested: false, closed: false, lastMessageAt: Date.now(), resyncs: 0 };
    this.#run = run;
    this.#live = { seq: turn.seq, parts: [], startedAt: Date.now(), ...live };
    run.unsubscribe = this.#deps.wake?.(() => this.wake());
    this.#emit();
    return run;
  }

  async #start(conversationId: string, turn: Turn, retry: boolean, key?: string): Promise<void> {
    const run = this.#begin(conversationId, turn);
    const page = this.#deps.pageState?.();
    run.key = key ?? this.#deps.newKey?.() ?? ulid();
    const request: StartRunRequest = {
      v: RUN_PROTOCOL_VERSION,
      idempotencyKey: run.key,
      conversationId,
      ...(this.#deps.scope ? { scope: this.#deps.scope } : {}),
      // An edit the runner has not taken yet (a refused one asked again too) goes as the edit, and
      // without `retry`: a runner that does not know `edit` refuses it as a stale turn.
      turn: { seq: turn.seq, user: turn.user, ...(this.#edited === turn ? { edit: true } : retry ? { retry: true } : {}) },
      model: this.#deps.model(),
      settings: this.#deps.settings(),
      ...(page ? { page } : {}),
    };
    run.askingSince = Date.now();
    for (let failures = 0; ; failures++) {
      try {
        const { runId } = await this.#deps.client.start(request);
        run.runId = runId;
        // The runner took the edit: its head holds the edited message from now on.
        if (this.#edited === turn) this.#edited = undefined;
        // Stopped before the answer came: the run it started is stopped now, best effort.
        if (run.closed && run.stopRequested) void this.#deps.client.stop(runId).catch(() => undefined);
        break;
      } catch (error) {
        if (run.closed) return;
        // No answer, or the runner is down for now: the run may have started, so the same start (same key) is asked again.
        if (!retryable(error)) return this.#refused(run, error);
        // Until the next ask would come later than START_GIVE_UP_MS after the first (or the last wake): then the turn fails, with Retry.
        if (Date.now() + this.#delay(failures) - run.askingSince! > START_GIVE_UP_MS) return this.#gaveUp(run, error);
        this.#down(run, { stream: true });
        await this.#pause(run, failures);
        if (run.closed) return;
      }
    }
    if (run.closed) return;
    await this.#follow(run);
  }

  async #follow(run: Run): Promise<void> {
    for (let failures = 0; !run.closed; ) {
      const connection = new AbortController();
      run.connection = connection;
      let resync = false;
      try {
        const response = await this.#deps.client.events(run.runId!, run.lastEventId, connection.signal);
        if (!response.body) throw new Error('The run sent no event stream.');
        const quietMs = this.#deps.quietMs ?? RUN_QUIET_MS;
        const listen = () => {
          clearTimeout(run.quiet);
          run.quiet = setTimeout(() => this.#down(run, { stream: true }), quietMs);
        };
        listen();
        const alive = () => {
          listen();
          run.lastMessageAt = Date.now();
          // Anything from the runner, its keep-alive included: the stream is up again.
          this.#down(run, { stream: false });
        };
        for await (const message of readSse(response.body, this.#deps.idleMs ?? RUN_IDLE_MS, alive)) {
          if (run.closed) return;
          failures = 0;
          if (!this.#accept(run, message)) {
            resync = true;
            break;
          }
          if (run.closed) return;
        }
      } catch (error) {
        clearTimeout(run.quiet);
        if (run.closed) return;
        // The runner no longer knows the run, or refuses this viewer; any other refusal is asked again (a replica catching up).
        if (error instanceof RunnerHttpError && (error.status === 404 || error.status === 410)) return this.#lost(run);
        if (error instanceof RunnerHttpError && (error.status === 401 || error.status === 403)) return this.#denied(run, error);
      }
      clearTimeout(run.quiet);
      if (run.closed) return;
      // An event that did not fit what is shown: the whole journal is read again, from `run-started`
      // (after the usual wait, so a runner whose journal never fits is not asked in a tight loop).
      if (resync) {
        run.lastEventId = undefined;
        await this.#pause(run, run.resyncs++);
        continue;
      }
      if (run.reconnectNow) {
        run.reconnectNow = false;
        continue;
      }
      // The stream dropped, went quiet past its keep-alives, or could not be opened: down until it is open again.
      this.#down(run, { stream: true });
      await this.#pause(run, failures++);
    }
  }

  /** Applies one message unless it was applied already; `false` when it does not fit (read the journal again). */
  #accept(run: Run, message: SseMessage): boolean {
    if (message.id !== undefined && run.lastEventId !== undefined && Number(message.id) <= Number(run.lastEventId)) return true;
    let event: RunEvent;
    try {
      event = JSON.parse(message.data) as RunEvent;
    } catch {
      return false;
    }
    const id = message.id !== undefined ? Number(message.id) : undefined;
    // Announced to the page already (before a resync, or before a reload), and taken into this run's state already (before a resync).
    const heard = id !== undefined && run.firedThrough !== undefined && id <= run.firedThrough;
    const known = id !== undefined && run.appliedThrough !== undefined && id <= run.appliedThrough;
    if (!this.#apply(run, event, heard, known)) return false;
    if (message.id !== undefined) run.lastEventId = message.id;
    if (id !== undefined && !heard) run.firedThrough = id;
    if (id !== undefined && !known) run.appliedThrough = id;
    return true;
  }

  #apply(run: Run, event: RunEvent, heard: boolean, known: boolean): boolean {
    const live = this.#live;
    // The run moves on after the runner asked its model again: any event but the retry itself, an error,
    // a step taken back or the run's start (as the page's own loop takes any part but `start` or `error`).
    if (!NOT_PROGRESS.has(event.type)) this.#down(run, { retry: false });
    switch (event.type) {
      case 'run-started':
      case 'text-delta':
      case 'tool-call':
      case 'tool-result':
      case 'tool-error':
      case 'parts-truncate':
        if (!live || !applyRunEvent(live.parts, event)) return false;
        this.#emit();
        return true;
      case 'subagent-progress':
        // A card's state, set to what it was: rebuilt from a replay as well.
        this.#deps.progress?.set(event.toolCallId, event.progress ?? undefined);
        return true;
      case 'tool-reported':
        if (!heard) this.#deps.onToolResult?.(event.result);
        return true;
      case 'network-retry':
        this.#down(run, { retry: true });
        if (!known) (run.turn.assistant.networkRetries ??= []).push(event.trace);
        if (!heard) this.dispatchEvent(new CustomEvent<AgentRetryDetail>('network-retry', { detail: { attempt: event.attempt, trace: event.trace } }));
        return true;
      case 'error':
        run.error = event;
        return true;
      case 'run-ended':
        void this.#settle(run, event);
        return true;
      default:
        return true;
    }
  }

  /** How the run ended goes on the turn while it still shows (as the page's own reply does), then the head is read again. */
  async #settle(run: Run, ended: Extract<RunEvent, { type: 'run-ended' }>): Promise<void> {
    const { assistant } = run.turn;
    if (ended.status === 'error') {
      const failed = run.error;
      const message = failed?.message ?? 'The reply failed.';
      const kind = errorKind(failed?.kind);
      const trace = failed?.trace ?? localTrace(message);
      assistant.status = 'error';
      assistant.error = message;
      if (failed?.detail) assistant.errorDetail = failed.detail;
      assistant.errorKind = kind;
      assistant.errorTrace = trace;
      if (ended.resumable) assistant.resume = { messages: [...ended.messages], steps: ended.steps, at: Date.now() };
      this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { kind, message, ...(failed?.detail ? { detail: failed.detail } : {}), trace } }));
    } else {
      assistant.status = ended.status === 'stopped' ? 'aborted' : 'done';
      if (ended.status === 'done' && ended.endedBy !== undefined) assistant.stopped = ended.endedBy;
      if (ended.status === 'ran_out') assistant.ranOut = true;
    }
    assistant.messages = ended.messages;
    if (run.runId) this.#ended.add(run.runId);
    await this.#finish(run, false);
  }

  /**
   * Ends following the run: the stream closes and the reply stops showing as live, but the agent stays
   * `running` until the head was read again, so nothing sent meanwhile lands on the chat being replaced
   * (a message that waits in the box goes once it is read).
   */
  async #finish(run: Run, headWins: boolean): Promise<void> {
    this.#teardown(run);
    if (this.#run === run) {
      // Ended on the page, with no `run-ended` to say what it kept: what it showed is kept as the turn's messages.
      if (headWins && this.#live?.parts.length) {
        const kept = messagesFromParts(this.#live.parts, (id) => this.#deps.progress?.get?.(id));
        run.turn.assistant.messages = kept.messages;
        run.unreceived = kept.unreceived;
      }
      this.#live = null;
      this.#emit();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.#reread(run, headWins), new Promise<void>((resolve) => (timer = setTimeout(resolve, REREAD_TIMEOUT_MS)))]);
    } finally {
      clearTimeout(timer);
      this.#release(run);
    }
  }

  /**
   * The chat's head again, as the runner saved it. What is kept for this page only (the error's
   * details and trace, its resume point, the retries) carries over to the turn read back; a head that
   * does not show the run's end yet does not replace how the run said it ended. `headWins`: the page
   * does not know how the run ended (it lost track of it), so any finished head is the answer.
   */
  async #reread(run: Run, headWins: boolean): Promise<void> {
    const { store } = this.#deps;
    if (store.current?.id !== run.conversationId) return;
    try {
      await this.#deps.reread(run.conversationId);
    } catch (error) {
      console.warn('[chat-cvt] could not read the chat again after its reply', error);
      return;
    }
    const conversation = store.current;
    const settled = run.turn;
    const fresh = conversation?.id === run.conversationId ? conversation.turns.find((turn) => turn.seq === settled.seq) : undefined;
    if (!fresh || fresh === settled) return;
    const unfinished = fresh.assistant.status === 'streaming' || (fresh.assistant.status === 'error' && fresh.assistant.error === CUT_OFF);
    if (headWins) {
      // Ended on the page: only a head whose reply finished, or that holds more of it, replaces what the page kept.
      if (unfinished && !holdsMore(partsFromMessages(fresh.assistant.messages), partsFromMessages(settled.assistant.messages), run.unreceived ?? new Set())) {
        fresh.assistant = settled.assistant;
        this.#emit();
      }
      return;
    }
    if (fresh.assistant.status !== settled.assistant.status) fresh.assistant = settled.assistant;
    else {
      const { errorDetail, errorKind: kind, errorTrace, networkRetries, resume } = settled.assistant;
      Object.assign(fresh.assistant, {
        ...(errorDetail !== undefined ? { errorDetail } : {}),
        ...(kind !== undefined ? { errorKind: kind } : {}),
        ...(errorTrace !== undefined ? { errorTrace } : {}),
        ...(networkRetries !== undefined ? { networkRetries } : {}),
        ...(resume !== undefined ? { resume } : {}),
      });
    }
    this.#emit();
  }

  /** The runner no longer knows the run (it ended long ago): how it ended is read from the head. */
  async #lost(run: Run): Promise<void> {
    // Not noted as ended: a run the runner still lists (it was lost here, not seen to end) is followed again.
    Object.assign(run.turn.assistant, { status: 'error', error: RUN_LOST });
    await this.#finish(run, true);
  }

  /** The runner refuses this viewer the run's events: the turn fails with an auth error here; the run itself is the runner's. */
  async #denied(run: Run, error: RunnerHttpError): Promise<void> {
    const trace = localTrace(error.message, error.status, error.name);
    Object.assign(run.turn.assistant, { status: 'error', error: RUN_DENIED, errorKind: 'auth', errorTrace: trace });
    this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { kind: 'auth', message: RUN_DENIED, trace } }));
    await this.#finish(run, true);
  }

  /** Stop did not end the run in time, or the runner refused it: the reply ends on the page as stopped. */
  #stoppedHere(run: Run): void {
    if (run.closed || this.#run !== run) return;
    run.turn.assistant.status = 'aborted';
    void this.#finish(run, true);
  }

  /**
   * Sends a stop (`call`) until it is answered: at the reconnect waits, at most {@link STOP_ATTEMPTS}
   * times, whether or not the reply still shows here. Resolves `true` when the runner refused it.
   */
  async #stopRemotely(conversationId: string, call: () => Promise<void>): Promise<boolean> {
    const delays = this.#deps.client.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    for (let attempt = 0; attempt < STOP_ATTEMPTS; attempt++) {
      try {
        await call();
        return false;
      } catch (error) {
        if (!retryable(error)) {
          console.warn(`[chat-cvt] the runner refused to stop the reply in ${conversationId}`, error);
          return true;
        }
        const ms = delays.length ? delays[Math.min(attempt, delays.length - 1)]! : 0;
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    }
    console.warn(`[chat-cvt] could not reach the runner to stop the reply in ${conversationId}`);
    return false;
  }

  /** The start was refused, so nothing ran: the turn fails here, and the runner saved nothing to read again. */
  #refused(run: Run, error: unknown): void {
    const http = error instanceof RunnerHttpError ? error : undefined;
    const code = http?.body?.error;
    const message = code === 'run-active' ? RUN_ACTIVE : http?.body?.message || (error instanceof Error ? error.message : String(error));
    const kind = refusalKind(code);
    const trace = localTrace(message, http?.status, error instanceof Error ? error.name : undefined);
    Object.assign(run.turn.assistant, {
      status: 'error',
      error: message,
      errorKind: kind,
      errorTrace: trace,
      // Nothing ran: asking again cannot run a tool twice.
      resume: { messages: [], steps: 0, at: Date.now() },
    });
    this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { kind, message, trace } }));
    this.#close(run);
  }

  /**
   * A start still failing (no answer, or the runner down for now) after {@link START_GIVE_UP_MS}: the
   * turn fails with an error the chat offers Retry for, and a Retry asks afresh. An earlier ask may
   * have reached the runner and started a run whose id the page never learned. It is left running, as
   * `leave()` leaves a run (opening the chat again finds it), and not stopped by its key: the chat asks
   * again by itself the moment the page is back online, and a stop still on its way then would end the
   * very reply that ask follows. Retry asks with this start's key, so the runner answers with that run
   * rather than refusing a second one as `run-active`.
   */
  #gaveUp(run: Run, error: unknown): void {
    const http = error instanceof RunnerHttpError ? error : undefined;
    const kind: ErrorKind = !http ? 'network' : http.status === 429 ? 'rate_limit' : 'unavailable';
    const trace = localTrace(error instanceof Error ? error.message : String(error), http?.status, error instanceof Error ? error.name : undefined);
    Object.assign(run.turn.assistant, {
      status: 'error',
      error: START_GAVE_UP,
      errorKind: kind,
      errorTrace: trace,
      // No run id was ever learned, so no step of it reached the page: asking again starts the reply over.
      resume: { messages: [], steps: 0, at: Date.now() },
    });
    this.#unanswered.set(run.turn, run.key!);
    this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { kind, message: START_GAVE_UP, trace } }));
    this.#close(run);
  }

  /** The reconnect delay for the `failures`-th failure in a row. */
  #delay(failures: number): number {
    const delays = this.#deps.client.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    return delays.length ? delays[Math.min(failures, delays.length - 1)]! : 0;
  }

  /** Waits the reconnect delay for the `failures`-th failure in a row; the page waking ends the wait. */
  #pause(run: Run, failures: number): Promise<void> {
    const ms = this.#delay(failures);
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (run.wakeWait === done) run.wakeWait = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      run.wakeWait = done;
    });
  }

  /**
   * Notes the event stream (`stream`) or the runner's model connection (`retry`) down or up; the reply's
   * status line says it is reconnecting while either is down. Emits only when that changes.
   */
  #down(run: Run, change: { stream?: boolean; retry?: boolean }): void {
    if (change.stream !== undefined) run.streamDown = change.stream;
    if (change.retry !== undefined) run.modelRetrying = change.retry;
    const live = this.#live;
    const down = Boolean(run.streamDown || run.modelRetrying);
    if (this.#run !== run || run.closed || !live || Boolean(live.reconnecting) === down) return;
    live.reconnecting = down;
    this.#emit();
  }

  #close(run: Run): void {
    this.#teardown(run);
    this.#release(run);
  }

  /** Nothing more is done for the run: its stream, its wait and its wake listener go. */
  #teardown(run: Run): void {
    if (run.closed) return;
    run.closed = true;
    clearTimeout(run.quiet);
    run.connection?.abort();
    run.wakeWait?.();
    run.unsubscribe?.();
  }

  #release(run: Run): void {
    if (this.#run !== run) return;
    this.#run = undefined;
    this.#live = null;
    this.#emit();
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

/**
 * A reply's parts as the messages a turn keeps: its words and calls in order, then each call's result.
 * A call whose result never reached the page gets {@link RESULT_NOT_RECEIVED} (a subagent's, a result
 * with status `unreceived`, for its card): it may have finished on the runner. Also says which calls those were.
 */
function messagesFromParts(parts: readonly TurnPart[], progressOf: (id: string) => RunSubagentProgress | undefined): { messages: ModelMessage[]; unreceived: Set<string> } {
  const unreceived = new Set<string>();
  const said: Exclude<Extract<ModelMessage, { role: 'assistant' }>['content'], string> = [];
  const results: ToolResultPart[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.text.trim()) said.push({ type: 'text', text: part.text });
      continue;
    }
    said.push({ type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
    if (part.state === 'calling') unreceived.add(part.toolCallId);
    const output: ToolResultPart['output'] =
      part.state === 'done'
        ? typeof part.output === 'string'
          ? { type: 'text', value: part.output }
          : { type: 'json', value: (part.output ?? null) as JSONValue }
        : part.state === 'error'
          ? { type: 'error-text', value: part.error ?? '' }
          : part.toolName === DISPATCH_AGENT
            ? { type: 'json', value: unreceivedSubagent(progressOf(part.toolCallId)) as unknown as JSONValue }
            : { type: 'error-text', value: RESULT_NOT_RECEIVED };
    results.push({ type: 'tool-result', toolCallId: part.toolCallId, toolName: part.toolName, output });
  }
  if (said.length === 0) return { messages: [], unreceived };
  return { messages: [{ role: 'assistant', content: said }, ...(results.length ? [{ role: 'tool' as const, content: results }] : [])], unreceived };
}

/** A subagent whose result never reached the page, with how far it was last seen to have got. */
export function unreceivedSubagent(progress: RunSubagentProgress | undefined): SubagentResult {
  return {
    kind: SUBAGENT_KIND,
    status: 'unreceived',
    summary: '',
    steps: progress?.steps ?? 0,
    toolCalls: progress?.toolCalls ?? 0,
    activity: [],
    error: RESULT_NOT_RECEIVED,
    // A write subagent keeps its edits as last seen: their count, since their paths never reached the page.
    ...(progress?.mode === 'write' ? { mode: 'write' as const, changed: [], changedCount: progress.changed ?? 0, ranCommands: progress.ranCommands ?? 0 } : {}),
  };
}

/**
 * Whether a saved reply holds more than the page kept of the same one. Both are a start of one event
 * stream, and the head saves whole steps, so it holds more when it has more parts, or as many with the
 * real result of a call the page never got (`unreceived`, by id), or the last words written further. A
 * result made up when the head was read back (the placeholder a write subagent saved mid-run gets) is not one.
 */
function holdsMore(head: readonly TurnPart[], kept: readonly TurnPart[], unreceived: ReadonlySet<string>): boolean {
  if (head.length !== kept.length) return head.length > kept.length;
  const placeholder = (output: unknown) => isSubagentOutput(output) && (output as { status?: unknown }).status === 'interrupted';
  const answered = head.some((saved) => saved.kind === 'tool' && unreceived.has(saved.toolCallId) && saved.state === 'done' && !placeholder(saved.output));
  const [headLast, keptLast] = [head.at(-1), kept.at(-1)];
  const furtherWords = headLast?.kind === 'text' && keptLast?.kind === 'text' && headLast.text.length > keptLast.text.length;
  return answered || furtherWords;
}

/** Whether a failed call is worth making again: no answer came, or the runner is down or busy for now. */
function retryable(error: unknown): boolean {
  if (error instanceof RunnerHttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return unanswered(error);
}

const KINDS: ReadonlySet<string> = new Set<ErrorKind>(['free_tier_exhausted', 'free_tier_not_free', 'fund_empty', 'insufficient_buzz', 'blocked', 'auth', 'rate_limit', 'timeout', 'network', 'assistant_unavailable', 'unavailable', 'unknown']);

function errorKind(kind: string | undefined): ErrorKind {
  return kind && KINDS.has(kind) ? (kind as ErrorKind) : 'unknown';
}

function refusalKind(code: RunErrorCode | undefined): ErrorKind {
  switch (code) {
    case 'unauthorized':
      return 'auth';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'unknown';
  }
}

/** A trace for a failure the page saw itself: the start never became a run. */
function localTrace(message: string, statusCode?: number, name?: string): ErrorTrace {
  return { stage: 'request', step: 0, msIntoStep: 0, message, ...(name ? { name } : {}), ...(statusCode !== undefined ? { statusCode } : {}) };
}
