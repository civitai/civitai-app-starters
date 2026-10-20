import { ulid } from 'ulid';

import type { AgentErrorDetail, AgentRetryDetail } from '../agent/agent.js';
import type { ChatAgent } from '../agent/chat-agent.js';
import type { LiveTurn } from '../agent/core.js';
import type { ErrorTrace } from '../agent/error-trace.js';
import {
  applyRunEvent,
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
import type { ChatToolResult } from '../tools/gate.js';
import type { Attachment, Turn } from '../types.js';
import type { ErrorKind } from '../ux/humanize.js';
import { RECONNECT_DELAYS_MS, RunnerClient, RunnerHttpError } from './runner-client.js';
import { readSse, type SseMessage } from './sse.js';

/** An event stream that sent nothing (not even its keep-alive comment) for this long is taken as dead and opened again. */
export const RUN_IDLE_MS = 3 * RUN_KEEPALIVE_MS;

/** What a turn shows when its run could no longer be found and its chat could not be read again. */
export const RUN_LOST = 'Lost track of this reply. Open the chat again to see how it ended.';

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
  progress?: { set(id: string, progress: RunSubagentProgress | undefined): void };
  /** A tool call finished, as the runner's gate reported it. */
  onToolResult?(result: ChatToolResult): void;
  /** Calls `listener` whenever the page wakes (shown again, back online, restored); returns how to stop. */
  wake?(listener: () => void): () => void;
  newKey?(): string;
  idleMs?: number;
}

interface Run {
  conversationId: string;
  turn: Turn;
  runId?: string;
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
  /** Ends the wait before the next reconnect, while one waits. */
  wakeWait?: () => void;
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
  #attaching = false;

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
    if (this.running) return;
    // In remote mode the store writes nothing: the turn is the page's until the runner saves it.
    const turn = this.#deps.store.appendUserTurn(content, attachments, refs);
    const conversation = this.#deps.store.current;
    if (!conversation) return;
    await this.#start(conversation.id, turn, false);
  }

  async retry(): Promise<void> {
    const conversation = this.#deps.store.current;
    const turn = conversation?.turns.at(-1);
    if (this.running || !conversation || turn?.assistant.status !== 'error') return;
    turn.assistant = { messages: [], status: 'streaming' };
    await this.#start(conversation.id, turn, true);
  }

  /** The viewer's Stop: asks the runner to stop the run. The reply keeps showing until the run says it ended. */
  abort(): void {
    const run = this.#run;
    if (!run || run.closed || run.stopRequested) return;
    run.stopRequested = true;
    if (run.runId) void this.#sendStop(run);
  }

  /** Stops following the run, which carries on on the server; opening its chat again follows it again. */
  leave(): void {
    if (this.#run) this.#close(this.#run);
  }

  /**
   * Looks for a live run of the open chat `conversationId` and follows it from its start, as the
   * reply of its turn: after a reload, or a chat opened on another device. Whether it found one.
   */
  async reattach(conversationId: string): Promise<boolean> {
    if (this.#run || this.#attaching) return false;
    this.#attaching = true;
    try {
      const summary = await this.#deps.client.lookup(conversationId);
      const conversation = this.#deps.store.current;
      if (!summary || this.#run || conversation?.id !== conversationId) return false;
      let turn = conversation.turns.find((t) => t.seq === summary.seq);
      if (!turn) {
        // Started before the runner saved its turn: the turn is shown from what the runner says.
        if (summary.seq !== (conversation.turns.at(-1)?.seq ?? 0) + 1) return false;
        turn = this.#deps.store.appendUserTurn(summary.user.content, summary.user.attachments ?? [], summary.user.refs ?? []);
      }
      // Only the latest turn can be replying.
      if (turn !== conversation.turns.at(-1)) return false;
      turn.assistant = { messages: [], status: 'streaming' };
      const run = this.#begin(conversationId, turn);
      run.runId = summary.runId;
      void this.#follow(run);
      return true;
    } catch (error) {
      console.warn('[chat-cvt] could not look for a reply still running', error);
      return false;
    } finally {
      this.#attaching = false;
    }
  }

  /**
   * The page woke: a reconnect waiting for its turn goes at once, and a connection that has been quiet
   * for longer than the runner's keep-alive (it may have died while the page slept) is opened again.
   */
  wake(): void {
    const run = this.#run;
    if (!run || run.closed) return;
    if (run.wakeWait) run.wakeWait();
    else if (run.connection && Date.now() - run.lastMessageAt > RUN_KEEPALIVE_MS) {
      run.reconnectNow = true;
      run.connection.abort();
    }
  }

  #begin(conversationId: string, turn: Turn): Run {
    const run: Run = { conversationId, turn, stopRequested: false, closed: false, lastMessageAt: Date.now() };
    this.#run = run;
    this.#live = { seq: turn.seq, parts: [] };
    run.unsubscribe = this.#deps.wake?.(() => this.wake());
    this.#emit();
    return run;
  }

  async #start(conversationId: string, turn: Turn, retry: boolean): Promise<void> {
    const run = this.#begin(conversationId, turn);
    const page = this.#deps.pageState?.();
    const request: StartRunRequest = {
      v: RUN_PROTOCOL_VERSION,
      idempotencyKey: this.#deps.newKey?.() ?? ulid(),
      conversationId,
      ...(this.#deps.scope ? { scope: this.#deps.scope } : {}),
      turn: { seq: turn.seq, user: turn.user, ...(retry ? { retry: true } : {}) },
      model: this.#deps.model(),
      settings: this.#deps.settings(),
      ...(page ? { page } : {}),
    };
    for (let failures = 0; ; failures++) {
      try {
        run.runId = (await this.#deps.client.start(request)).runId;
        break;
      } catch (error) {
        if (run.closed) return;
        // No answer, or the runner is down for now: the run may have started, so the same start (same key) is asked again.
        if (!retryable(error)) return this.#refused(run, error);
        await this.#pause(run, failures);
        if (run.closed) return;
      }
    }
    if (run.closed) return;
    if (run.stopRequested) void this.#sendStop(run);
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
        for await (const message of readSse(response.body, this.#deps.idleMs ?? RUN_IDLE_MS)) {
          if (run.closed) return;
          run.lastMessageAt = Date.now();
          failures = 0;
          if (!this.#accept(run, message)) {
            resync = true;
            break;
          }
          if (run.closed) return;
        }
      } catch (error) {
        if (run.closed) return;
        if (error instanceof RunnerHttpError && (error.status === 404 || error.status === 410)) return this.#lost(run);
      }
      if (run.closed) return;
      // An event that did not fit what is shown: the whole journal is read again, from `run-started`
      // (after the usual wait, so a runner whose journal never fits is not asked in a tight loop).
      if (resync) run.lastEventId = undefined;
      if (run.reconnectNow) {
        run.reconnectNow = false;
        continue;
      }
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
    if (!this.#apply(run, event)) return false;
    if (message.id !== undefined) run.lastEventId = message.id;
    return true;
  }

  #apply(run: Run, event: RunEvent): boolean {
    const live = this.#live;
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
        this.#deps.progress?.set(event.toolCallId, event.progress ?? undefined);
        return true;
      case 'tool-reported':
        this.#deps.onToolResult?.(event.result);
        return true;
      case 'network-retry':
        (run.turn.assistant.networkRetries ??= []).push(event.trace);
        this.dispatchEvent(new CustomEvent<AgentRetryDetail>('network-retry', { detail: { attempt: event.attempt, trace: event.trace } }));
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
    this.#close(run);
    await this.#reread(run);
  }

  /**
   * The chat's head again, as the runner saved it. What is kept for this page only (the error's
   * details and trace, its resume point, the retries) carries over to the turn read back; a head that
   * does not show the run's end yet does not replace how the run said it ended.
   */
  async #reread(run: Run): Promise<void> {
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
    Object.assign(run.turn.assistant, { status: 'error', error: RUN_LOST });
    this.#close(run);
    await this.#reread(run);
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

  async #sendStop(run: Run): Promise<void> {
    for (let failures = 0; !run.closed; failures++) {
      try {
        await this.#deps.client.stop(run.runId!);
        return;
      } catch (error) {
        if (run.closed || !retryable(error)) {
          if (!run.closed) console.warn('[chat-cvt] the runner refused to stop the reply', error);
          return;
        }
        await this.#pause(run, failures);
      }
    }
  }

  /** Waits the reconnect delay for the `failures`-th failure in a row; the page waking ends the wait. */
  #pause(run: Run, failures: number): Promise<void> {
    const delays = this.#deps.client.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS;
    const ms = delays.length ? delays[Math.min(failures, delays.length - 1)]! : 0;
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

  #close(run: Run): void {
    if (run.closed) return;
    run.closed = true;
    run.connection?.abort();
    run.wakeWait?.();
    run.unsubscribe?.();
    if (this.#run !== run) return;
    this.#run = undefined;
    this.#live = null;
    this.#emit();
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

/** Whether a failed call is worth making again: no answer came, or the runner is down or busy for now. */
function retryable(error: unknown): boolean {
  if (error instanceof RunnerHttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return error instanceof TypeError;
}

const KINDS: ReadonlySet<string> = new Set<ErrorKind>(['free_tier_exhausted', 'free_tier_not_free', 'insufficient_buzz', 'blocked', 'auth', 'rate_limit', 'timeout', 'network', 'assistant_unavailable', 'unavailable', 'unknown']);

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
