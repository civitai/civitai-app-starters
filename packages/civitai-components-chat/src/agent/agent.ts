import { generateText, type LanguageModel, type ModelMessage, type ToolSet } from 'ai';

import { outputTokenCap } from '../config.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PostManager } from '../posting/post.js';
import type { ConversationStore } from '../store/conversation-store.js';
import type { Attachment, ResumePoint, Turn } from '../types.js';
import { humanize, type HumanError } from '../ux/humanize.js';
import { AgentCore, type AgentCoreOutcome, type LiveTurn } from './core.js';
import { errorTrace, type ErrorTrace, type TraceContext } from './error-trace.js';
import { buildModelMessages } from './history.js';
import { PROVIDER_OPTIONS } from './provider.js';
import { buildSystemPrompt, buildTurnContext } from './system-prompt.js';

export type { LiveTurn } from './core.js';

export interface AgentDeps {
  /** Read at the start of every reply, so a change in Settings applies from the next one. */
  model(): LanguageModel;
  /** Naming a conversation is a few words; it need not use a costly model the viewer picked. */
  titleModel?(): LanguageModel;
  /** The most one step of the reply may write, read at the start of every reply; the page's default when absent. */
  maxOutputTokens?(): number;
  store: ConversationStore;
  jobs: JobManager;
  posts?: PostManager;
  toolSet(turn: { conversationId: string; seq: number }): Promise<ToolSet>;
  attachments(): Attachment[];
  customInstructions?(): string | undefined;
  /** Read at the start of every reply, so the embedding page can change them at any time. */
  hostInstructions?(): string | undefined;
  /** Whether the user hears replies read aloud, read at the start of every reply. */
  spokenReplies?(): boolean;
  isHostTool?(name: string): boolean;
  /** What the assistant is told about the panels on screen, read at the start of every reply. */
  panels?(): string | undefined;
  systemPrompt?(): string | ((defaults: string) => string) | undefined;
  /** The words the viewer sees for a reply that failed; `humanize` unless set. */
  describeError?(error: unknown): HumanError;
  now?(): Date;
  /**
   * The wait before each automatic retry of one drop of the browser's network (see
   * `network-retry.ts`); its length is how many retries one drop gets, and `[]` turns them off.
   */
  networkRetryDelaysMs?: readonly number[];
  /** The most automatic retries one reply makes in all; `MAX_NETWORK_RETRIES_PER_REPLY` unless set. */
  maxNetworkRetries?: number;
}

/** What the agent's `error` event carries: the words the viewer sees, and where the reply failed. */
export interface AgentErrorDetail extends HumanError {
  trace: ErrorTrace;
}

/** What the agent's `network-retry` event carries: which retry of the reply this is (from 1), and where the reply was cut. */
export interface AgentRetryDetail {
  attempt: number;
  trace: ErrorTrace;
}

/** Runs one assistant reply at a time and records it on the thread store; the reply's loop is {@link AgentCore}'s. */
export class Agent extends EventTarget {
  #deps: AgentDeps;
  #core: AgentCore;

  constructor(deps: AgentDeps) {
    super();
    this.#deps = deps;
    this.#core = new AgentCore({ describeError: (error) => (this.#deps.describeError ?? humanize)(error), change: () => this.#emit() });
  }

  /** The reply now running, as shown so far; `null` between replies. */
  get live(): LiveTurn | null {
    return this.#core.live;
  }

  get running(): boolean {
    return this.#core.running;
  }

  async send(content: string, attachments: Attachment[] = [], refs: string[] = []): Promise<void> {
    if (this.running) return;
    const turn = this.#deps.store.appendUserTurn(content, attachments, refs);
    await this.#run(turn);
  }

  abort(): void {
    this.#core.abort();
  }

  /**
   * Runs the latest reply again after it failed, e.g. once the viewer agreed to pay for it, or asked
   * again after the connection was lost. The user's message is not sent again as a new one: the same
   * turn is asked for again.
   *
   * When the failed reply has a resume point (`assistant.resume`, see {@link ResumePoint}) it carries
   * on from there: the steps that finished, with every tool they ran and its result, are sent as they
   * are and kept on screen, and only the step that failed is asked for again, as the automatic retry
   * of a dropped connection does. Without one (a reply whose failed step had already called a tool,
   * or a chat opened from storage), the reply starts over.
   */
  async retry(): Promise<void> {
    const turn = this.#deps.store.current?.turns.at(-1);
    if (this.running || turn?.assistant.status !== 'error') return;
    const from = turn.assistant.resume;
    turn.assistant = { messages: [], status: 'streaming' };
    await this.#run(turn, from);
  }

  async #run(turn: Turn, from?: ResumePoint): Promise<void> {
    const conversation = this.#deps.store.current;
    if (!conversation) return;
    if (!this.running) {
      this.#deps.store.replyStarted?.(turn);
      // Carrying on from saved steps: saved at once as running here, so another tab sees it live and does not offer it too.
      if (from) this.#checkpoint(turn, from.messages);
    }
    const outcome = await this.#core.run({
      seq: turn.seq,
      ...(from ? { from } : {}),
      tools: () => this.#deps.toolSet({ conversationId: conversation.id, seq: turn.seq }),
      request: (tools) => {
        const hostInstructions = this.#deps.hostInstructions?.();
        const system = buildSystemPrompt({
          now: this.#deps.now?.() ?? new Date(),
          customInstructions: this.#deps.customInstructions?.(),
          canPost: this.#deps.posts?.available ?? false,
          tools: Object.keys(tools),
          host: { tools: Object.keys(tools).filter((name) => this.#deps.isHostTool?.(name)), instructs: Boolean(hostInstructions?.trim()) },
          rules: this.#deps.systemPrompt?.(),
        });
        const context = buildTurnContext({ attachments: this.#deps.attachments(), panels: this.#deps.panels?.(), hostInstructions, spoken: this.#deps.spokenReplies?.() ?? false });
        const history = buildModelMessages(conversation.turns, (key) => this.#deps.jobs.get(key) ?? this.#deps.posts?.get(key), { context });
        return {
          model: this.#deps.model(),
          system,
          history,
          maxOutputTokens: outputTokenCap(this.#deps.maxOutputTokens?.()),
          ...(this.#deps.networkRetryDelaysMs ? { networkRetryDelaysMs: this.#deps.networkRetryDelaysMs } : {}),
          ...(this.#deps.maxNetworkRetries !== undefined ? { maxNetworkRetries: this.#deps.maxNetworkRetries } : {}),
        };
      },
      retrying: (attempt, trace) => this.#retrying(turn, attempt, trace),
      // Progress saved as the reply goes, so a page that sleeps or closes loses at most the step it was on.
      // Every tool call is saved as it starts and as its result comes in (`toolProgress`), and each step
      // that ran a tool as it finishes. So Continue elsewhere sends a call that finished with its result
      // and marks one that started and did not finish as interrupted: neither runs again. The one gap is a
      // call whose start was not saved yet when the page died (one save's round trip). A step that ran no
      // tool is the reply's last, and is saved as it ends.
      toolProgress: ({ messages }) => this.#checkpoint(turn, messages),
      stepFinished: ({ messages, calledTools }) => calledTools && this.#checkpoint(turn, messages),
      // While the reply still shows: the turn takes how it ended (and `error` fires) before `live` clears.
      settled: (ended) => this.#settle(turn, ended),
    });
    if (!outcome) return;

    try {
      await this.#deps.store.completeTurn(turn);
    } catch (error) {
      console.warn('[chat-cvt] could not save the reply', error);
    }
    if (turn.seq === 1 && conversation.titleSource === 'first-message' && turn.assistant.status === 'done') {
      void this.#nameConversation(turn);
    }
  }

  #checkpoint(turn: Turn, messages: ModelMessage[]): void {
    this.#deps.store.checkpoint?.(turn, { messages }).catch((error: unknown) => console.warn('[chat-cvt] could not save the reply so far', error));
  }

  #settle(turn: Turn, ended: AgentCoreOutcome): void {
    if (ended.status === 'error') this.#failed(turn, ended.error, ended.where!, ended.resume);
    else {
      turn.assistant.status = ended.status;
      if (ended.stopped !== undefined) turn.assistant.stopped = ended.stopped;
      else if (ended.ranOut) turn.assistant.ranOut = true;
    }
    turn.assistant.messages = ended.messages;
  }

  #failed(turn: Turn, error: unknown, where: TraceContext, resume?: ResumePoint): void {
    turn.assistant.status = 'error';
    if (resume) turn.assistant.resume = { ...resume, messages: [...resume.messages] };
    const human = (this.#deps.describeError ?? humanize)(error);
    const trace = errorTrace(error, where);
    turn.assistant.error = human.message;
    turn.assistant.errorDetail = human.detail;
    turn.assistant.errorKind = human.kind;
    turn.assistant.errorTrace = trace;
    this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { ...human, trace } }));
  }

  /** Notes a cut the reply recovers from by itself: kept on the turn for this session, and sent as `network-retry`. */
  #retrying(turn: Turn, attempt: number, trace: ErrorTrace): void {
    (turn.assistant.networkRetries ??= []).push(trace);
    this.dispatchEvent(new CustomEvent<AgentRetryDetail>('network-retry', { detail: { attempt, trace } }));
  }

  async #nameConversation(turn: Turn): Promise<void> {
    try {
      const { text } = await generateText({
        model: (this.#deps.titleModel ?? this.#deps.model)(),
        maxOutputTokens: 24,
        temperature: 0.3,
        providerOptions: PROVIDER_OPTIONS,
        prompt: `Give this chat a title of at most five words. Reply with the title only, no quotes.\n\nUser: ${turn.user.content.slice(0, 500)}`,
      });
      const title = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (title && this.#deps.store.current?.titleSource === 'first-message') {
        await this.#deps.store.setTitle(title, 'llm');
      }
    } catch (error) {
      // Free only and the title model has no free replies: the chat keeps its first-message title
      // quietly; a refusal of the reply itself already says so once. A title that could not be saved
      // is not announced either: every later save of the chat carries it again.
      if (humanize(error).kind !== 'free_tier_not_free') console.warn('[chat-cvt] could not name the conversation', error);
    }
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}
