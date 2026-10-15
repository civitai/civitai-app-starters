import { generateText, stepCountIs, streamText, type AssistantModelMessage, type LanguageModel, type StopCondition, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai';

import { outputTokenCap, stepLimit } from '../config.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PostManager } from '../posting/post.js';
import type { ConversationStore } from '../store/conversation-store.js';
import type { Attachment, Turn } from '../types.js';
import { endedReply } from '../tools/gate.js';
import { humanize, type HumanError } from '../ux/humanize.js';
import { errorTrace, type ErrorTrace, type TraceContext } from './error-trace.js';
import { buildModelMessages } from './history.js';
import type { TurnPart } from './parts.js';
import { PROVIDER_OPTIONS } from './provider.js';
import { buildSystemPrompt, buildTurnContext } from './system-prompt.js';
import { stripToolMarkup } from './tool-markup.js';

/**
 * A tool that hands the next move to the viewer (an ask panel, a choice shown) ends the reply, so the
 * assistant cannot act for them. A call whose result does not say so (a choice that could not be
 * shown) does not, so the assistant can fix it in the same reply.
 */
const awaitsUser: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.toolResults.some((result) => (result.output as { awaitsUser?: unknown } | undefined)?.awaitsUser === true) ?? false;

/** The words the page ended the reply on, when a call in its last step did (`beforeToolCall` with `stop: true`). */
function endedByPage(steps: { toolResults: { output: unknown }[] }[]): string | undefined {
  for (const result of steps.at(-1)?.toolResults ?? []) {
    const message = endedReply(result.output);
    if (message !== undefined) return message;
  }
  return undefined;
}

const LAST_STEP =
  'This is your last step this turn: you cannot call tools now. Tell the user plainly what got done and what did not, and that they can ask you to carry on. Do not say you are about to do something.';

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
  isHostTool?(name: string): boolean;
  /** What the assistant is told about the panels on screen, read at the start of every reply. */
  panels?(): string | undefined;
  systemPrompt?(): string | ((defaults: string) => string) | undefined;
  /** The words the viewer sees for a reply that failed; `humanize` unless set. */
  describeError?(error: unknown): HumanError;
  now?(): Date;
}

/** What the agent's `error` event carries: the words the viewer sees, and where the reply failed. */
export interface AgentErrorDetail extends HumanError {
  trace: ErrorTrace;
}

export interface LiveTurn {
  seq: number;
  parts: TurnPart[];
}

/** Runs one assistant reply at a time and records it on the thread store. */
export class Agent extends EventTarget {
  live: LiveTurn | null = null;
  #deps: AgentDeps;
  #abort?: AbortController;

  constructor(deps: AgentDeps) {
    super();
    this.#deps = deps;
  }

  get running(): boolean {
    return this.#abort !== undefined;
  }

  async send(content: string, attachments: Attachment[] = [], refs: string[] = []): Promise<void> {
    if (this.running) return;
    const turn = this.#deps.store.appendUserTurn(content, attachments, refs);
    await this.#run(turn);
  }

  abort(): void {
    this.#abort?.abort();
  }

  /** Runs the latest reply again after it failed, e.g. once the viewer agreed to pay for it. */
  async retry(): Promise<void> {
    const turn = this.#deps.store.current?.turns.at(-1);
    if (this.running || turn?.assistant.status !== 'error') return;
    turn.assistant = { messages: [], status: 'streaming' };
    await this.#run(turn);
  }

  async #run(turn: Turn): Promise<void> {
    const conversation = this.#deps.store.current;
    if (!conversation) return;
    const controller = new AbortController();
    this.#abort = controller;
    this.live = { seq: turn.seq, parts: [] };
    this.#emit();

    let completed: ModelMessage[] = [];
    let stepText = '';
    let streamError: unknown;
    // Read once per reply, so a change applies from the next one.
    const maxSteps = stepLimit();
    // Steps whose answer started streaming; between one step's end and the next one's start its request is out.
    let steps = 0;
    let streaming = false;
    let finished = 0;
    let since = Date.now();
    let toolsBuilt = false;
    let failedAt: TraceContext | undefined;
    let stopped: string | undefined;
    const where = (): TraceContext => this.#where(toolsBuilt, streaming ? steps : finished + 1, since, streaming);
    try {
      const tools = await this.#deps.toolSet({ conversationId: conversation.id, seq: turn.seq });
      toolsBuilt = true;
      const hostInstructions = this.#deps.hostInstructions?.();
      const system = buildSystemPrompt({
        now: this.#deps.now?.() ?? new Date(),
        customInstructions: this.#deps.customInstructions?.(),
        canPost: this.#deps.posts?.available ?? false,
        tools: Object.keys(tools),
        host: { tools: Object.keys(tools).filter((name) => this.#deps.isHostTool?.(name)), instructs: Boolean(hostInstructions?.trim()) },
        rules: this.#deps.systemPrompt?.(),
      });
      const context = buildTurnContext({ attachments: this.#deps.attachments(), panels: this.#deps.panels?.(), hostInstructions });
      const result = streamText({
        model: this.#deps.model(),
        system,
        messages: buildModelMessages(conversation.turns, (key) => this.#deps.jobs.get(key) ?? this.#deps.posts?.get(key), { context }),
        tools,
        // A page that ended the reply ends it here: no further step is asked for (and paid).
        stopWhen: [stepCountIs(maxSteps), awaitsUser, ({ steps }) => (stopped ??= endedByPage(steps)) !== undefined],
        abortSignal: controller.signal,
        maxOutputTokens: outputTokenCap(this.#deps.maxOutputTokens?.()),
        temperature: 0.7,
        providerOptions: PROVIDER_OPTIONS,
        // The last allowed step must speak, or a run of failing tools ends in silence; told why, it does not promise more.
        prepareStep: ({ stepNumber }) => (stepNumber >= maxSteps - 1 ? { toolChoice: 'none', system: `${system}\n\n${LAST_STEP}` } : undefined),
        onStepFinish: (step) => {
          completed = [...step.response.messages];
        },
      });
      // Counted from the steps that started, not from what they said: a last step that returns nothing
      // still started, so a reply cut off by the limit is known as one. (Thanks to #555 for the approach.)
      let forcedAt = -1;
      for await (const part of result.fullStream) {
        if (part.type === 'start-step') {
          stepText = '';
          steps++;
          streaming = true;
          if (steps >= maxSteps && this.live) forcedAt = this.live.parts.length;
        } else if (part.type === 'finish-step') {
          finished++;
          streaming = false;
          since = Date.now();
        }
        if (part.type === 'text-delta') stepText += part.text;
        // Where it was when the first error came: the stream may still close its step after it.
        if (part.type === 'error' && streamError === undefined) failedAt = where();
        if (part.type === 'error') streamError = part.error;
        // The last step cannot call tools; tool-call syntax it writes as text is not shown (see tool-markup.ts).
        if (forcedAt >= 0 && part.type === 'text-delta') this.#showForced(forcedAt, stripToolMarkup(stepText));
        else this.#onPart(part);
      }
      if (controller.signal.aborted) turn.assistant.status = 'aborted';
      else if (streamError !== undefined) this.#failed(turn, streamError, failedAt ?? where());
      else {
        turn.assistant.status = 'done';
        if (stopped !== undefined) turn.assistant.stopped = stopped;
        else if (steps >= maxSteps) turn.assistant.ranOut = true;
      }
    } catch (error) {
      if (controller.signal.aborted) turn.assistant.status = 'aborted';
      else this.#failed(turn, error, where());
    }

    if (steps >= maxSteps) {
      completed = withoutToolMarkup(completed);
      stepText = stripToolMarkup(stepText);
    }
    // A step cut short never reached onStepFinish; keep what the user already read.
    if (turn.assistant.status !== 'done' && stepText.trim() !== '') completed.push({ role: 'assistant', content: stepText });
    turn.assistant.messages = completed;
    this.live = null;
    this.#abort = undefined;
    this.#emit();

    try {
      await this.#deps.store.completeTurn(turn);
    } catch (error) {
      console.warn('[chat-cvt] could not save the reply', error);
    }
    if (turn.seq === 1 && conversation.titleSource === 'first-message' && turn.assistant.status === 'done') {
      void this.#nameConversation(turn);
    }
  }

  #failed(turn: Turn, error: unknown, where: TraceContext): void {
    turn.assistant.status = 'error';
    const human = (this.#deps.describeError ?? humanize)(error);
    const trace = errorTrace(error, where);
    turn.assistant.error = human.message;
    turn.assistant.errorDetail = human.detail;
    turn.assistant.errorKind = human.kind;
    turn.assistant.errorTrace = trace;
    this.dispatchEvent(new CustomEvent<AgentErrorDetail>('error', { detail: { ...human, trace } }));
  }

  /** Where the reply is, for an error's trace: a tool still running wins over the step's request or stream. */
  #where(toolsBuilt: boolean, step: number, since: number, streaming: boolean): TraceContext {
    const lastTool = [...(this.live?.parts ?? [])].reverse().find((part) => part.kind === 'tool');
    const tool = lastTool?.kind === 'tool' ? { name: lastTool.toolName, state: lastTool.state } : undefined;
    const stage = !toolsBuilt ? 'tools' : tool?.state === 'calling' ? 'tool' : streaming ? 'stream' : 'request';
    return { stage, step: toolsBuilt ? step : 0, msIntoStep: Date.now() - since, ...(tool ? { lastTool: tool } : {}) };
  }

  /** The last step's words so far, cleaned, as one text part from where that step began. */
  #showForced(at: number, text: string): void {
    const live = this.live;
    if (!live) return;
    if (text === '') live.parts.splice(at);
    else live.parts[at] = { kind: 'text', text };
    this.#emit();
  }

  #onPart(part: TextStreamPart<ToolSet>): void {
    const live = this.live;
    if (!live) return;
    switch (part.type) {
      case 'text-delta': {
        const last = live.parts.at(-1);
        if (last?.kind === 'text') last.text += part.text;
        else live.parts.push({ kind: 'text', text: part.text });
        break;
      }
      case 'tool-call':
        live.parts.push({ kind: 'tool', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, state: 'calling' });
        break;
      case 'tool-result':
      case 'tool-error': {
        const tool = live.parts.find((p) => p.kind === 'tool' && p.toolCallId === part.toolCallId);
        if (tool?.kind !== 'tool') break;
        if (part.type === 'tool-result') Object.assign(tool, { state: 'done', output: part.output });
        else Object.assign(tool, { state: 'error', error: humanize(part.error).message });
        break;
      }
      default:
        return;
    }
    this.#emit();
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
      // quietly; a refusal of the reply itself already says so once.
      if (humanize(error).kind !== 'free_tier_not_free') console.warn('[chat-cvt] could not name the conversation', error);
    }
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

/** The reply's last assistant message with tool-call syntax taken out of its text, and dropped if nothing is left. */
function withoutToolMarkup(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return messages;
  let cleaned: AssistantModelMessage;
  if (typeof last.content === 'string') cleaned = { ...last, content: stripToolMarkup(last.content) };
  else {
    const content: Exclude<AssistantModelMessage['content'], string> = [];
    for (const part of last.content) {
      if (part.type !== 'text') content.push(part);
      else if (stripToolMarkup(part.text) !== '') content.push({ ...part, text: stripToolMarkup(part.text) });
    }
    cleaned = { ...last, content };
  }
  return cleaned.content.length === 0 ? messages.slice(0, -1) : [...messages.slice(0, -1), cleaned];
}
