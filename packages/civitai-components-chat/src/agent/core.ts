import { stepCountIs, streamText, type AssistantModelMessage, type JSONValue, type LanguageModel, type ToolResultPart, type ModelMessage, type StopCondition, type TextStreamPart, type ToolSet } from 'ai';

import { stepLimit } from '../config.js';
import type { ResumePoint } from '../types.js';
import { endedReply } from '../tools/gate.js';
import { humanize, type HumanError } from '../ux/humanize.js';
import { errorTrace, type ErrorTrace, type TraceContext } from './error-trace.js';
import { isNetworkDrop, MAX_NETWORK_RETRIES_PER_REPLY, NETWORK_RETRY_DELAYS_MS, pauseBeforeRetry } from './network-retry.js';
import { partsFromMessages, type TurnPart } from './parts.js';
import { PROVIDER_OPTIONS } from './provider.js';
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

export interface LiveTurn {
  seq: number;
  parts: TurnPart[];
  /** When the reply started (ms since the epoch): the reply's status line counts its time from it. */
  startedAt?: number;
  /** The connection the reply comes over is down and being made again (a dropped model stream asked for again, a runner's event stream opened again). */
  reconnecting?: boolean;
  /** A reply a server runner was already running when this page opened its chat (a reload, another device): followed, not started, here. */
  reattached?: boolean;
}

/** What one reply asks the model with, built once its tools are. */
export interface AgentCoreRequest {
  model: LanguageModel;
  system: string;
  /** The conversation before this reply, as the model sees it. */
  history: ModelMessage[];
  maxOutputTokens: number;
  /**
   * The wait before each automatic retry of one drop of the network (see `network-retry.ts`); its
   * length is how many retries one drop gets, and `[]` turns them off. `NETWORK_RETRY_DELAYS_MS` unless set.
   */
  networkRetryDelaysMs?: readonly number[];
  /** The most automatic retries one reply makes in all; `MAX_NETWORK_RETRIES_PER_REPLY` unless set. */
  maxNetworkRetries?: number;
  /** The most steps the reply may take, the last one in words; the page's `stepLimit()` unless set (a subagent's own cap). */
  maxSteps?: number;
  /** What the last allowed step is told, added to `system`; the built-in words (to the user) unless set. */
  lastStep?: string;
  /** Asked before each step: `true` makes it the last one, in words (no tools), as if the step limit were reached. */
  wordsOnly?(): boolean;
}

export interface AgentCoreRun {
  /** The turn the reply belongs to, for `live`. */
  seq: number;
  /** Where to carry on from: its finished steps are sent as they are and shown at once. */
  from?: ResumePoint;
  /** Builds the reply's tools. A failure here is one at the `tools` stage: nothing was asked for. */
  tools(): Promise<ToolSet>;
  /** Everything else the reply asks with. A failure here is one before any request. */
  request(tools: ToolSet): AgentCoreRequest;
  /** A cut the reply recovers from by itself: which retry of the reply this is (from 1), and where it was cut. */
  retrying?(attempt: number, trace: ErrorTrace): void;
  /**
   * A step finished with no error in it: the reply's finished messages so far (every step that finished,
   * each with its tool calls and their results, from `from` on), how many steps that is, and whether this
   * step called a tool. For saving progress as the reply goes; a step closed after an error is not one.
   */
  stepFinished?(step: AgentCoreStep): void;
  /**
   * In the step now running, a tool call started or its result (or error) came in: the reply's finished
   * messages so far, then this step as it stands: its words and every call it made so far, and the
   * results that came in. A call with no result after it started and has not finished. For saving each
   * call as it starts and as it lands, so a reply that dies mid-step never runs a call again on Continue.
   */
  toolProgress?(progress: { messages: ModelMessage[] }): void;
  /** Called once with how the reply ended, while `live` still shows it and `running` is still true. */
  settled?(outcome: AgentCoreOutcome): void;
}

/** What `stepFinished` carries. */
export interface AgentCoreStep {
  messages: ModelMessage[];
  steps: number;
  calledTools: boolean;
}

/** How one reply ended. */
export interface AgentCoreOutcome {
  status: 'done' | 'error' | 'aborted';
  /**
   * What the reply kept: every step that finished, and on a reply that did not finish the words of the
   * step that was cut, as the viewer read them. Tool-call syntax the last allowed step wrote is taken out.
   */
  messages: ModelMessage[];
  /** `done` only: the words the page ended the reply on. */
  stopped?: string;
  /** `done` only: the reply used every step it may take. */
  ranOut?: boolean;
  /** Steps whose answer started streaming, in all (a step asked for again after a drop counts once). */
  steps: number;
  /** `error` only: what ended the reply, and where. */
  error?: unknown;
  where?: TraceContext;
  /** `error` only: where asking again can carry on from without running a tool twice, when anywhere. */
  resume?: ResumePoint;
}

export interface AgentCoreDeps {
  /** The words a tool's error shows as; `humanize` unless set. */
  describeError?(error: unknown): HumanError;
  /** Fired whenever `live` or `running` changes. */
  change?(): void;
}

/**
 * One assistant reply at a time, headless: the step loop with its stop conditions, the automatic
 * retries of a dropped connection, and the parts shown so far (`live`). It knows no page, store or
 * element; what it asks with comes from `run`, and what it ended with goes back in the outcome. `Agent`
 * wraps it for the element.
 */
export class AgentCore {
  #live: LiveTurn | null = null;
  #abort?: AbortController;
  #deps: AgentCoreDeps;

  constructor(deps: AgentCoreDeps = {}) {
    this.#deps = deps;
  }

  /** The reply now running, as shown so far; `null` between replies. */
  get live(): LiveTurn | null {
    return this.#live;
  }

  get running(): boolean {
    return this.#abort !== undefined;
  }

  /** Stops the reply now running; it ends `aborted`. */
  abort(): void {
    this.#abort?.abort();
  }

  /** Runs one reply. Resolves `undefined` without asking anything while another runs. */
  async run(run: AgentCoreRun): Promise<AgentCoreOutcome | undefined> {
    if (this.running) return undefined;
    const from = run.from;
    const controller = new AbortController();
    this.#abort = controller;
    this.#live = { seq: run.seq, parts: from ? partsFromMessages(from.messages) : [], startedAt: Date.now() };
    this.#emit();

    let completed: ModelMessage[] = from ? [...from.messages] : [];
    let stepText = '';
    // Whether `stepText`'s step is still open: a step that finished is in `completed` already.
    let stepOpen = false;
    let streamError: unknown;
    // Read once per reply, so a change applies from the next one; a request may set its own.
    let maxSteps = stepLimit();
    // Steps whose answer started streaming; between one step's end and the next one's start its request is out.
    let steps = from?.steps ?? 0;
    let streaming = false;
    let finished = from?.steps ?? 0;
    let since = Date.now();
    let toolsBuilt = false;
    let failedAt: TraceContext | undefined;
    let stopped: string | undefined;
    // Where asking again could carry on from if the reply fails, set as each pass ends; none when the
    // failed step had called a tool (it may have run, and is in no finished step to send as it is).
    let resumable: ResumePoint | undefined;
    let outcome: Omit<AgentCoreOutcome, 'messages' | 'steps'>;
    const where = (): TraceContext => this.#where(toolsBuilt, streaming ? steps : finished + 1, since, streaming);
    try {
      const tools = await run.tools();
      toolsBuilt = true;
      const { model, system, history, maxOutputTokens, maxSteps: ownSteps, lastStep = LAST_STEP, wordsOnly, ...retry } = run.request(tools);
      if (ownSteps !== undefined) maxSteps = ownSteps;
      const retryDelays = retry.networkRetryDelaysMs ?? NETWORK_RETRY_DELAYS_MS;
      const retryCap = retry.maxNetworkRetries ?? MAX_NETWORK_RETRIES_PER_REPLY;
      // Retries of the drop now being recovered from (reset once a step finishes, i.e. the connection
      // came back), and of the whole reply.
      let retriesThisDrop = 0;
      let retriesInReply = 0;
      // Counted from the steps that started, not from what they said: a last step that returns nothing
      // still started, so a reply cut off by the limit is known as one. (Thanks to #555 for the approach.)
      let forcedAt = -1;
      // One pass per attempt. A pass the browser's network cut off resumes from the last step that
      // finished: those steps' messages (and every tool they ran) are sent as they are and not asked
      // for again; only the step that was cut is asked for again.
      for (;;) {
        const resumeFrom = completed;
        const before = finished;
        // What the viewer was shown up to the step now being asked for.
        let shownBeforeStep = this.#live?.parts.length ?? 0;
        // Tool calls (and their results) in the step now streaming.
        let callsInStep = 0;
        // Whether an error came in the step now streaming: a step that finishes without one shows the
        // connection is back.
        let errorInStep = false;
        // The cut: where the latest error came, which is the one that ended the stream. An earlier error
        // the stream recovered from by itself (it carried on and finished steps) is not the cut. Kept
        // with the reply as it was then, for asking again from there, the tool calls its step had made
        // by then, and every call that came after it to the end of the stream: a provider may still send
        // a call after an error part, and the SDK may still run it.
        let atCut: { shown: number; finished: number; completed: ModelMessage[]; calls: number } | undefined;
        let callsAfterCut = 0;
        const cutHere = () => {
          failedAt = where();
          atCut = { shown: shownBeforeStep, finished, completed, calls: callsInStep };
          callsAfterCut = 0;
        };
        // Each step of this pass, as the SDK recorded it (`onStepFinish`) and as this loop read it (whether an
        // error came in it, at its `finish-step`). The SDK hands `finish-step` on before it records the step,
        // so a step is reported once both happened, in order.
        const recorded: { messages: ModelMessage[]; calledTools: boolean }[] = [];
        const clean: boolean[] = [];
        let reported = 0;
        // The step now running, as far as its tool calls go: each call as it started, each result as it came in.
        let stepCalls: { toolCallId: string; toolName: string; input: unknown }[] = [];
        let stepResults: { toolCallId: string; toolName: string; output: ToolResultPart['output'] }[] = [];
        const reportTools = () => {
          if (controller.signal.aborted || !run.toolProgress) return;
          const said = stepText.trim() ? [{ type: 'text' as const, text: stepText }] : [];
          const step: ModelMessage[] = [{ role: 'assistant', content: [...said, ...stepCalls.map((call) => ({ type: 'tool-call' as const, ...call }))] }];
          if (stepResults.length) step.push({ role: 'tool', content: stepResults.map((result) => ({ type: 'tool-result' as const, ...result })) });
          run.toolProgress({ messages: [...completed, ...step] });
        };
        const report = () => {
          while (reported < recorded.length && reported < clean.length) {
            const index = reported++;
            if (clean[index] && !controller.signal.aborted) run.stepFinished?.({ ...recorded[index]!, steps: before + index + 1 });
          }
        };
        streamError = undefined;
        failedAt = undefined;
        stepText = '';
        try {
          const result = streamText({
            model,
            system,
            messages: [...history, ...resumeFrom],
            tools,
            // A page that ended the reply ends it here: no further step is asked for (and paid).
            stopWhen: [stepCountIs(maxSteps - before), awaitsUser, ({ steps }) => (stopped ??= endedByPage(steps)) !== undefined],
            abortSignal: controller.signal,
            maxOutputTokens,
            temperature: 0.7,
            providerOptions: PROVIDER_OPTIONS,
            // The last allowed step must speak, or a run of failing tools ends in silence; told why, it does not promise more.
            prepareStep: ({ stepNumber }) => (before + stepNumber >= maxSteps - 1 || wordsOnly?.() ? { toolChoice: 'none', system: `${system}\n\n${lastStep}` } : undefined),
            onStepFinish: (step) => {
              completed = [...resumeFrom, ...step.response.messages];
              recorded.push({ messages: completed, calledTools: step.toolCalls.length > 0 });
              report();
            },
          });
          for await (const part of result.fullStream) {
            // The model answers again (not the stream's own start, nor another error): the reply is back.
            if (this.#live?.reconnecting && part.type !== 'start' && part.type !== 'error') {
              this.#live.reconnecting = false;
              this.#emit();
            }
            if (part.type === 'start-step') {
              stepText = '';
              stepCalls = [];
              stepResults = [];
              stepOpen = true;
              steps++;
              streaming = true;
              shownBeforeStep = this.#live?.parts.length ?? 0;
              callsInStep = 0;
              errorInStep = false;
              if (steps >= maxSteps && this.#live) forcedAt = this.#live.parts.length;
            } else if (part.type === 'finish-step') {
              clean.push(!errorInStep);
              report();
              finished++;
              streaming = false;
              stepOpen = false;
              since = Date.now();
              // A step that finished with no error came back from any drop: the next drop gets its own retries.
              if (!errorInStep) retriesThisDrop = 0;
              // A finished step is kept as it is: what it showed and the tools it called are not cut.
              shownBeforeStep = this.#live?.parts.length ?? 0;
              callsInStep = 0;
            }
            if (part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'tool-error') {
              callsInStep++;
              callsAfterCut++;
            }
            // As the SDK's own step messages carry them (no tool here has its own toModelOutput).
            if (part.type === 'tool-call') {
              stepCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
              reportTools();
            } else if (part.type === 'tool-result' && !part.preliminary) {
              stepResults.push({ toolCallId: part.toolCallId, toolName: part.toolName, output: typeof part.output === 'string' ? { type: 'text', value: part.output } : { type: 'json', value: (part.output ?? null) as JSONValue } });
              reportTools();
            } else if (part.type === 'tool-error') {
              stepResults.push({ toolCallId: part.toolCallId, toolName: part.toolName, output: { type: 'error-text', value: errorText(part.error) } });
              reportTools();
            }
            if (part.type === 'text-delta') stepText += part.text;
            // Each error moves the cut there, with the trace's context: the stream may still close its
            // step after it, or carry on past it.
            if (part.type === 'error') {
              streamError = part.error;
              errorInStep = true;
              cutHere();
            }
            // The last step cannot call tools; tool-call syntax it writes as text is not shown (see tool-markup.ts).
            if (forcedAt >= 0 && part.type === 'text-delta') this.#showForced(forcedAt, stripToolMarkup(stepText));
            else this.#onPart(part);
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            streamError = error;
            cutHere();
          }
        }
        if (controller.signal.aborted || streamError === undefined || !atCut) break;
        resumable = atCut.calls + callsAfterCut === 0 && atCut.finished < maxSteps ? { messages: atCut.completed, steps: atCut.finished, at: Date.now() } : undefined;
        // Asked again only when the cut step had called no tool and no call came after the cut to the end
        // of the stream, so a tool can never run twice. The stream is read to its end rather than dropped
        // at the error: an abort cannot take back a tool the SDK already started, and only the whole
        // stream shows every call it made. (A provider may follow an error part with a call and a
        // tool-calls finish, which ai 6 runs.) Steps that finished before the cut, after an earlier error
        // the stream recovered from too, are finished steps and are kept. A failed reply keeps every
        // step that finished: one that ran a tool keeps its call and result.
        if (
          retriesThisDrop >= retryDelays.length ||
          retriesInReply >= retryCap ||
          atCut.calls + callsAfterCut > 0 ||
          atCut.finished >= maxSteps ||
          !isNetworkDrop(streamError)
        )
          break;
        const wait = retryDelays[retriesThisDrop]!;
        retriesThisDrop++;
        retriesInReply++;
        run.retrying?.(retriesInReply, errorTrace(streamError, failedAt ?? where()));
        // What the cut step showed goes, with any step closed after the error (none called a tool); the
        // step asked for again shows its own answer.
        this.#live?.parts.splice(atCut.shown);
        if (forcedAt >= atCut.shown) forcedAt = -1;
        ({ finished, completed } = atCut);
        steps = finished;
        streaming = false;
        stepText = '';
        stepOpen = false;
        // Down until the step asked for again sends its first part.
        if (this.#live) this.#live.reconnecting = true;
        this.#emit();
        await pauseBeforeRetry(wait, controller.signal);
        if (controller.signal.aborted) break;
        since = Date.now();
      }
      if (controller.signal.aborted) outcome = { status: 'aborted' };
      else if (streamError !== undefined) outcome = failure(streamError, failedAt ?? where(), resumable);
      else if (stopped !== undefined) outcome = { status: 'done', stopped };
      else if (steps >= maxSteps) outcome = { status: 'done', ranOut: true };
      else outcome = { status: 'done' };
    } catch (error) {
      if (controller.signal.aborted) outcome = { status: 'aborted' };
      // Failed outside a step: only the tools or the prompt failed to build, before any request (every
      // stream is read inside the loop's own try), so nothing ran and the reply carries on from where it
      // began, or from the steps a resumed reply had kept.
      else outcome = failure(error, where(), { messages: completed, steps: finished, at: Date.now() });
    }

    if (steps >= maxSteps) {
      completed = withoutToolMarkup(completed);
      stepText = stripToolMarkup(stepText);
    }
    // A step cut short never reached onStepFinish; keep what the user already read. A step that did
    // (closed after an error, or before a stop) is in `completed` already, and is not kept twice.
    if (outcome.status !== 'done' && stepOpen && stepText.trim() !== '') completed.push({ role: 'assistant', content: stepText });
    const ended: AgentCoreOutcome = { ...outcome, messages: completed, steps };
    run.settled?.(ended);
    this.#live = null;
    this.#abort = undefined;
    this.#emit();
    return ended;
  }

  /** Where the reply is, for an error's trace: a tool still running wins over the step's request or stream. */
  #where(toolsBuilt: boolean, step: number, since: number, streaming: boolean): TraceContext {
    const lastTool = [...(this.#live?.parts ?? [])].reverse().find((part) => part.kind === 'tool');
    const tool = lastTool?.kind === 'tool' ? { name: lastTool.toolName, state: lastTool.state } : undefined;
    const stage = !toolsBuilt ? 'tools' : tool?.state === 'calling' ? 'tool' : streaming ? 'stream' : 'request';
    return { stage, step: toolsBuilt ? step : 0, msIntoStep: Date.now() - since, ...(tool ? { lastTool: tool } : {}) };
  }

  /** The last step's words so far, cleaned, as one text part from where that step began. */
  #showForced(at: number, text: string): void {
    const live = this.#live;
    if (!live) return;
    if (text === '') live.parts.splice(at);
    else live.parts[at] = { kind: 'text', text };
    this.#emit();
  }

  #onPart(part: TextStreamPart<ToolSet>): void {
    const live = this.#live;
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
        else Object.assign(tool, { state: 'error', error: (this.#deps.describeError ?? humanize)(part.error).message });
        break;
      }
      default:
        return;
    }
    this.#emit();
  }

  #emit(): void {
    this.#deps.change?.();
  }
}

/** An error as the SDK words it for the model (`error-text`). */
function errorText(error: unknown): string {
  if (error == null) return 'unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

/**
 * A failed reply's outcome. The resume point is copied as it is now: the reply's messages may still
 * take the cut step's words, which are not a finished step and must not be sent again as one.
 */
function failure(error: unknown, where: TraceContext, resume?: ResumePoint): Omit<AgentCoreOutcome, 'messages' | 'steps'> {
  return { status: 'error', error, where, ...(resume ? { resume: { ...resume, messages: [...resume.messages] } } : {}) };
}

/** The reply's last assistant message with tool-call syntax taken out of its text, and dropped if nothing is left. */
export function withoutToolMarkup(messages: ModelMessage[]): ModelMessage[] {
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
