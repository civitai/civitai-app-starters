import { generateText, hasToolCall, stepCountIs, streamText, type LanguageModel, type StopCondition, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai';

import { MAX_OUTPUT_TOKENS, MAX_STEPS } from '../config.js';
import type { JobManager } from '../orchestration/jobs.js';
import type { PostManager } from '../posting/post.js';
import type { ThreadStore } from '../store/thread-store.js';
import { ASK_CHOICE } from '../tools/build.js';
import type { Attachment, Turn } from '../types.js';
import { humanize } from '../ux/humanize.js';
import { buildModelMessages } from './history.js';
import type { TurnPart } from './parts.js';
import { PROVIDER_OPTIONS } from './provider.js';
import { buildSystemPrompt } from './system-prompt.js';

/** A tool that hands the next move to the viewer (an ask panel) ends the reply, so the assistant cannot act for them. */
const awaitsUser: StopCondition<ToolSet> = ({ steps }) =>
  steps.at(-1)?.toolResults.some((result) => (result.output as { awaitsUser?: unknown } | undefined)?.awaitsUser === true) ?? false;

const LAST_STEP =
  'This is your last step this turn: you cannot call tools now. Tell the user plainly what got done and what did not, and that they can ask you to carry on. Do not say you are about to do something.';

export interface AgentDeps {
  /** Read at the start of every reply, so a change in Settings applies from the next one. */
  model(): LanguageModel;
  /** Naming a conversation is a few words; it need not use a costly model the viewer picked. */
  titleModel?(): LanguageModel;
  store: ThreadStore;
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
  now?(): Date;
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
    try {
      const tools = await this.#deps.toolSet({ conversationId: conversation.id, seq: turn.seq });
      const system = buildSystemPrompt({
        attachments: this.#deps.attachments(),
        now: this.#deps.now?.() ?? new Date(),
        customInstructions: this.#deps.customInstructions?.(),
        canPost: this.#deps.posts?.available ?? false,
        panels: this.#deps.panels?.(),
        tools: Object.keys(tools),
        host: { tools: Object.keys(tools).filter((name) => this.#deps.isHostTool?.(name)), instructions: this.#deps.hostInstructions?.() },
        rules: this.#deps.systemPrompt?.(),
      });
      const result = streamText({
        model: this.#deps.model(),
        system,
        messages: buildModelMessages(conversation.turns, (key) => this.#deps.jobs.get(key) ?? this.#deps.posts?.get(key)),
        tools,
        stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(ASK_CHOICE), awaitsUser],
        abortSignal: controller.signal,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        providerOptions: PROVIDER_OPTIONS,
        // The last allowed step must speak, or a run of failing tools ends in silence; told why, it does not promise more.
        prepareStep: ({ stepNumber }) => (stepNumber >= MAX_STEPS - 1 ? { toolChoice: 'none', system: `${system}\n\n${LAST_STEP}` } : undefined),
        onStepFinish: (step) => {
          completed = [...step.response.messages];
        },
      });
      for await (const part of result.fullStream) {
        if (part.type === 'start-step') stepText = '';
        if (part.type === 'text-delta') stepText += part.text;
        if (part.type === 'error') streamError = part.error;
        this.#onPart(part);
      }
      if (controller.signal.aborted) turn.assistant.status = 'aborted';
      else if (streamError !== undefined) this.#failed(turn, streamError);
      else turn.assistant.status = 'done';
    } catch (error) {
      if (controller.signal.aborted) turn.assistant.status = 'aborted';
      else this.#failed(turn, error);
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

  #failed(turn: Turn, error: unknown): void {
    turn.assistant.status = 'error';
    const human = humanize(error);
    turn.assistant.error = human.message;
    turn.assistant.errorDetail = human.detail;
    this.dispatchEvent(new CustomEvent('error', { detail: human }));
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
      console.warn('[chat-cvt] could not name the conversation', error);
    }
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}
