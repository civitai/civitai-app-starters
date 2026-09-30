import { isTerminal, type Workflow } from '@civitai/sdk';

import { APP_TAG, JOB_TAG, conversationTag } from '../config.js';
import type { McpConnection } from '../mcp/clients.js';
import { mcpResultToText, structuredOf, workflowIdOf } from '../mcp/result.js';
import { resultId } from '../store/attachments.js';
import type { Attachment, JobMetadata } from '../types.js';
import { humanize, humanizeText, type HumanError } from '../ux/humanize.js';
import type { Price } from '../ux/spending.js';
import type { OrchestrationApi } from './api.js';
import { failureOf, progressOf, readOutputs, type ResultMedia } from './outputs.js';

export type JobState =
  | 'pricing'
  | 'awaiting_confirmation'
  | 'submitting'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'rejected'
  | 'declined';

const SETTLED = new Set<JobState>(['succeeded', 'failed', 'canceled', 'expired', 'rejected', 'declined']);

/** What the MCP tool can do, read from its input schema. */
export interface JobToolInfo {
  name: string;
  whatif: boolean;
  submitOnly: boolean;
  tagging: boolean;
}

export interface JobDeps {
  api: Pick<OrchestrationApi, 'getWorkflow' | 'watchWorkflow' | 'addTag' | 'updateWorkflow'>;
  cancelWorkflow(workflowId: string): Promise<void>;
  mcp: Pick<McpConnection, 'callTool'>;
  resolveArgs(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  decide(price: Price | null): 'auto' | 'confirm';
  hideMatureContent(): boolean;
  /** Workflows carrying every tag, newest first. */
  findWorkflows(tags: string[]): Promise<Workflow[]>;
}

export interface JobInit {
  id: string;
  conversationId: string;
  seq: number;
  toolCallId: string;
  tool: JobToolInfo;
  args: Record<string, unknown>;
}

/** What the assistant is told about a job, at call time and in every later turn. */
export interface JobSummary {
  job: string;
  status: JobState;
  estimatedBuzz?: number;
  results?: { id: string; kind: string; width?: number; height?: number; seconds?: number }[];
  /** What the service said when the job failed, so the assistant can explain instead of guessing. */
  reason?: string;
  note: string;
}

/** What a step does while it runs, and what it makes, for before it starts. */
const LABELS: Record<string, [doing: string, thing: string]> = {
  imageGen: ['Making your picture', 'Your picture'],
  textToImage: ['Making your picture', 'Your picture'],
  videoGen: ['Making your video', 'Your video'],
  aceStepAudio: ['Writing your song', 'Your song'],
  miniMaxMusic3: ['Writing your song', 'Your song'],
  yuE2: ['Writing your song', 'Your song'],
  textToSpeech: ['Recording the voice', 'The voice recording'],
  imageUpscaler: ['Sharpening your picture', 'A sharper picture'],
  videoUpscaler: ['Sharpening your video', 'A sharper video'],
  videoEnhancement: ['Sharpening your video', 'A sharper video'],
  convertImage: ['Converting your picture', 'The converted picture'],
  imageBackgroundRemoval: ['Removing the background', 'The cut-out'],
  videoBackgroundRemoval: ['Removing the background', 'The cut-out'],
  videoFrameExtraction: ['Pulling frames from the video', 'Frames from the video'],
  imageToSvg: ['Tracing your picture', 'The traced picture'],
  polyGen: ['Making your 3D model', 'Your 3D model'],
  training: ['Training your model', 'Your model'],
  imageResourceTraining: ['Training your model', 'Your model'],
};

/** What a run makes, by its step type: `run_step`'s own, or the last step of a `run_workflow`. */
export function stepTypeOf(args: Record<string, unknown>): string | undefined {
  if (typeof args.stepType === 'string') return args.stepType;
  const steps = Array.isArray(args.steps) ? args.steps : (args.steps as { steps?: unknown } | undefined)?.steps;
  const last = Array.isArray(steps) ? (steps.at(-1) as { $type?: unknown } | undefined) : undefined;
  return typeof last?.$type === 'string' ? last.$type : undefined;
}

const BLOCKING_TIMEOUT_MS = 10 * 60_000;
// The MCP gives up on a slow submit after 30 s while the orchestrator carries on and charges.
const RECOVER_WINDOW_MS = 90_000;
const RECOVER_POLL_MS = 5_000;
const UNHANDLED_TOOL_ERROR = /An error occurred invoking/i;

/** Priced, confirmed when needed, submitted without waiting, then watched, so the chat never blocks on a workflow. */
export class GenerationJob extends EventTarget {
  readonly id: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly toolCallId: string;
  readonly tool: JobToolInfo;
  readonly args: Record<string, unknown>;

  state: JobState = 'pricing';
  price: Price | null = null;
  workflowId?: string;
  workflow?: Workflow;
  progress: number | null = null;
  queued: number | null = null;
  error?: HumanError;
  media: ResultMedia[] = [];

  #deps: JobDeps;
  #run?: AbortController;
  #settledSent = false;
  #refusedAtQuote = false;

  constructor(deps: JobDeps, init: JobInit) {
    super();
    this.#deps = deps;
    this.id = init.id;
    this.conversationId = init.conversationId;
    this.seq = init.seq;
    this.toolCallId = init.toolCallId;
    this.tool = init.tool;
    this.args = init.args;
  }

  get label(): string {
    return LABELS[stepTypeOf(this.args) ?? '']?.[0] ?? 'Working on it';
  }

  get subject(): string {
    return LABELS[stepTypeOf(this.args) ?? '']?.[1] ?? 'Your request';
  }

  /** The server refused the request before anything ran, almost always because the input was wrong. */
  get refusedAtQuote(): boolean {
    return this.#refusedAtQuote && this.state === 'failed';
  }

  get settled(): boolean {
    return SETTLED.has(this.state);
  }

  /** A blocking MCP call has no workflow id until it returns, so it cannot be stopped. */
  get cancelable(): boolean {
    return this.state === 'running' && this.workflowId !== undefined;
  }

  get results(): Attachment[] {
    return this.media.map((media, index) => ({
      id: resultId(this.id, index + 1),
      kind: media.kind,
      source: { type: 'result', workflowId: this.workflowId ?? '', job: this.id, path: media.path },
      url: media.url,
      width: media.width,
      height: media.height,
      durationSec: media.durationSec,
      nsfwLevel: media.nsfwLevel,
      blocked: media.blocked,
    }));
  }

  get metadata(): JobMetadata {
    return {
      v: 1,
      app: 'chat-cvt',
      conversationId: this.conversationId,
      seq: this.seq,
      job: this.id,
      toolCallId: this.toolCallId,
      tool: this.tool.name,
    };
  }

  get tags(): string[] {
    return [APP_TAG, JOB_TAG, conversationTag(this.conversationId)];
  }

  /** Resolves once the job is running, waiting for the user, or refused; never on completion. */
  async start(): Promise<void> {
    await this.quote();
    if (this.state !== 'pricing') return;
    if (this.#deps.decide(this.price) === 'auto') await this.confirm();
    else this.#set('awaiting_confirmation');
  }

  async quote(): Promise<void> {
    this.error = undefined;
    this.#refusedAtQuote = false;
    this.#set('pricing');
    if (!this.tool.whatif) {
      this.price = null;
      return;
    }
    try {
      const args = await this.#deps.resolveArgs(this.args);
      const result = await this.#deps.mcp.callTool(this.tool.name, { ...args, whatif: true });
      if (result.isError) throw humanizeText(mcpResultToText(result));
      const structured = structuredOf(result) ?? {};
      const cost = (structured.cost ?? {}) as { total?: unknown; variable?: unknown };
      this.price = { total: Number(cost.total ?? 0), variable: cost.variable === true };
      if (structured.insufficientBuzz === true) {
        this.error = humanize({ status: 402, message: 'insufficient buzz' });
        this.#set('rejected');
      }
    } catch (error) {
      this.#refusedAtQuote = true;
      this.#fail(error);
    }
  }

  /** Resolves once submitted (or failed); watching carries on in the background. */
  async confirm(): Promise<void> {
    if (this.state !== 'pricing' && this.state !== 'awaiting_confirmation' && this.state !== 'declined') return;
    this.error = undefined;
    this.#set('submitting');
    const run = new AbortController();
    this.#run = run;
    try {
      const args = await this.#deps.resolveArgs(this.args);
      if (!this.tool.submitOnly) {
        this.#set('running');
        void this.#runBlocking(args, run.signal);
        return;
      }
      let workflowId: string | undefined;
      try {
        const result = await this.#deps.mcp.callTool(
          this.tool.name,
          { ...args, waitForCompletion: false, ...this.#taggingArgs() },
          { signal: run.signal },
        );
        if (result.isError) {
          const text = mcpResultToText(result);
          if (!UNHANDLED_TOOL_ERROR.test(text)) throw humanizeText(text);
          throw new Error(text);
        }
        workflowId = workflowIdOf(result);
        if (!workflowId) throw new Error('The orchestrator did not return a workflow id.');
      } catch (error) {
        if (run.signal.aborted || !this.tool.tagging || isHumanError(error)) throw error;
        workflowId = await this.#findSubmitted(run.signal);
        if (!workflowId) throw error;
      }
      this.workflowId = workflowId;
      this.#set('running');
      if (!this.tool.tagging) void this.#tagViaApi(workflowId);
      void this.#watch(workflowId, run.signal);
    } catch (error) {
      if (!run.signal.aborted) this.#fail(error);
    }
  }

  decline(): void {
    if (this.state === 'awaiting_confirmation') this.#set('declined');
  }

  async cancel(): Promise<void> {
    const workflowId = this.workflowId;
    if (!this.cancelable || !workflowId) return;
    await this.#deps.cancelWorkflow(workflowId);
    // Settle on the accepted cancel; whether the watch sees it first is a race.
    this.#run?.abort();
    this.#set('canceled');
  }

  async retry(): Promise<void> {
    this.#run?.abort();
    this.workflowId = undefined;
    this.workflow = undefined;
    this.media = [];
    this.progress = null;
    this.queued = null;
    this.#settledSent = false;
    await this.start();
  }

  /** Brings a job back from its workflow after a reload, watching it if it is still going. */
  resume(workflow: Workflow): void {
    this.apply(workflow);
    if (!isTerminal(workflow) && workflow.id) {
      const run = new AbortController();
      this.#run = run;
      void this.#watch(workflow.id, run.signal);
    }
  }

  /** A job that was never submitted: all that survives a reload is what the tool result said. */
  restore(state: JobState, price: Price | null): void {
    this.price = price;
    this.state = state;
  }

  dispose(): void {
    this.#run?.abort();
  }

  /** Buzz this job has cost, as best known: the workflow's own figure once it has one, else the quote. */
  get spent(): number {
    if (this.state !== 'submitting' && this.state !== 'running' && this.state !== 'succeeded' && this.state !== 'canceled') return 0;
    return this.workflow?.cost?.total ?? (this.state === 'canceled' ? 0 : (this.price?.total ?? 0));
  }

  apply(workflow: Workflow): void {
    this.workflow = workflow;
    this.workflowId = workflow.id ?? this.workflowId;
    const { progress, queued } = progressOf(workflow);
    this.progress = progress;
    this.queued = queued;
    this.media = readOutputs(workflow);
    if (workflow.cost?.total !== undefined && this.price === null) {
      this.price = { total: workflow.cost.total, variable: workflow.cost.variable === true };
    }
    switch (workflow.status) {
      case 'succeeded':
        this.#set('succeeded');
        break;
      case 'failed':
        this.error = humanizeText(failureOf(workflow) ?? 'failed');
        this.#set('failed');
        break;
      case 'canceled':
        this.#set('canceled');
        break;
      case 'expired':
        this.#set('expired');
        break;
      default:
        this.#set(isTerminal(workflow) ? 'failed' : 'running');
    }
  }

  summary(): JobSummary {
    const base = { job: this.id, status: this.state, estimatedBuzz: this.price?.total };
    switch (this.state) {
      case 'running':
      case 'submitting':
        return {
          ...base,
          note: 'Started. The user watches it in the chat. Say in one short sentence that it is on its way; do not describe settings.',
        };
      case 'pricing':
      case 'awaiting_confirmation':
        return {
          ...base,
          note: `Not started: waiting for the user to approve${this.price ? ` about ${this.price.total} Buzz` : ''} on the card. Nothing is being made yet. Reply in one short sentence of this form: "I've set up <what it will make> — it starts once you OK it on the card." Do not call the tool again.`,
        };
      case 'rejected':
        return {
          ...base,
          note: `Not started: the user does not have enough Buzz${this.price ? ` (needs about ${this.price.total})` : ''}. Tell them kindly; the card links to getting more.`,
        };
      case 'declined':
        return { ...base, note: 'The user chose not to run this.' };
      case 'succeeded':
        return {
          ...base,
          results: this.results.map((r) => ({
            id: r.id,
            kind: r.kind,
            width: r.width,
            height: r.height,
            seconds: r.durationSec,
          })),
          note: 'Finished; the user can see the results. Refer to them by these ids in later tool calls.',
        };
      case 'canceled':
        return { ...base, note: 'The user stopped it.' };
      case 'expired':
      case 'failed':
        return {
          ...base,
          reason: this.error?.detail?.slice(0, 500),
          note: 'It did not work and produced nothing. Tell the user it failed and, in plain words, why (reason is what the service said). Do not retry with other settings or another engine unless the user asks.',
        };
    }
  }

  async #runBlocking(args: Record<string, unknown>, signal: AbortSignal): Promise<void> {
    try {
      const result = await this.#deps.mcp.callTool(
        this.tool.name,
        { ...args, ...this.#taggingArgs() },
        {
          signal,
          timeoutMs: BLOCKING_TIMEOUT_MS,
          onProgress: ({ progress, total }) => {
            this.progress = total ? progress / total : null;
            this.#emit();
          },
        },
      );
      const workflowId = workflowIdOf(result);
      if (!workflowId) throw humanizeText(mcpResultToText(result));
      this.workflowId = workflowId;
      if (!this.tool.tagging) void this.#tagViaApi(workflowId);
      const workflow = await this.#deps.api.getWorkflow(workflowId, {
        signal,
        hideMatureContent: this.#deps.hideMatureContent(),
      });
      this.apply(workflow);
      // The tool gives up waiting before the workflow does.
      if (!isTerminal(workflow)) await this.#watch(workflowId, signal);
    } catch (error) {
      if (!signal.aborted) this.#fail(error);
    }
  }

  async #watch(workflowId: string, signal: AbortSignal): Promise<void> {
    try {
      for await (const workflow of this.#deps.api.watchWorkflow(workflowId, {
        signal,
        hideMatureContent: this.#deps.hideMatureContent(),
      })) {
        this.apply(workflow);
      }
    } catch (error) {
      if (!signal.aborted) this.#fail(error);
    }
  }

  #taggingArgs(): Record<string, unknown> {
    return this.tool.tagging ? { tags: this.tags, metadataJson: JSON.stringify(this.metadata) } : {};
  }

  /** The submit may have gone through even though its reply never arrived; our tags and job id find it. */
  async #findSubmitted(signal: AbortSignal): Promise<string | undefined> {
    const deadline = Date.now() + RECOVER_WINDOW_MS;
    for (;;) {
      try {
        const match = (await this.#deps.findWorkflows(this.tags)).find(
          (w) => (w.metadata as { job?: unknown } | undefined)?.job === this.id,
        );
        if (match?.id) return match.id;
      } catch {
        // A failed lookup is retried like an empty one.
      }
      if (signal.aborted || Date.now() + RECOVER_POLL_MS > deadline) return undefined;
      await new Promise((resolve) => setTimeout(resolve, RECOVER_POLL_MS));
    }
  }

  async #tagViaApi(workflowId: string): Promise<void> {
    try {
      for (const tag of this.tags) await this.#deps.api.addTag(workflowId, tag);
      await this.#deps.api.updateWorkflow(workflowId, { metadata: this.metadata });
    } catch (error) {
      console.warn('[chat-cvt] could not tag workflow', workflowId, error);
    }
  }

  #fail(error: unknown): void {
    this.error = isHumanError(error) ? error : humanize(error);
    this.#set('failed');
  }

  #set(state: JobState): void {
    this.state = state;
    this.#emit();
    if (this.settled && !this.#settledSent) {
      this.#settledSent = true;
      this.dispatchEvent(new Event('settled'));
    }
  }

  #emit(): void {
    this.dispatchEvent(new Event('change'));
  }
}

function isHumanError(value: unknown): value is HumanError {
  return value !== null && typeof value === 'object' && 'kind' in value && 'message' in value;
}

export function toolInfo(name: string, inputSchema: Record<string, unknown>): JobToolInfo {
  const properties = (inputSchema.properties ?? {}) as Record<string, unknown>;
  return {
    name,
    whatif: 'whatif' in properties,
    submitOnly: 'waitForCompletion' in properties,
    tagging: 'tags' in properties && 'metadataJson' in properties,
  };
}
