import { dynamicTool, jsonSchema, type LanguageModel, type ModelMessage, type Tool, type ToolSet } from 'ai';

import { OPEN_PANEL, UPDATE_PANEL } from '../panels/tools.js';
import { ASK_CHOICE } from '../tools/build.js';
import { endingOutput } from '../tools/gate.js';
import { humanize, type HumanError } from '../ux/humanize.js';
import { AgentCore, type AgentCoreOutcome } from './core.js';
import { defaultRules } from './system-prompt.js';
import { ACTIVITY_MAX, DISPATCH_AGENT, SUMMARY_MAX_CHARS, type SubagentResult, type SubagentStatus } from './subagent-result.js';
import { summarizeInput } from './tool-groups.js';

export { ACTIVITY_MAX, DISPATCH_AGENT, SUMMARY_MAX_CHARS, subagentResultOf, type SubagentResult, type SubagentStatus } from './subagent-result.js';

/**
 * Read-only subagents: the `dispatch_agent` tool. Its call runs a child reply on {@link AgentCore} with a
 * history of its own (only the task), an allowlisted subset of the reply's tools, and its own step and
 * tool-call caps, and gives the parent back a short result built by the chat, never the child's
 * transcript. Off unless the page opts in with {@link ChatSubagents}.
 */

/** The page's opt-in. Without it `dispatch_agent` is not offered at all. Read at the start of every reply. */
export interface ChatSubagents {
  /**
   * The tools a subagent may use, by the exact name the assistant sees (an added server's as
   * `${id}__${tool}`). An allowlist: a tool added later is not given to subagents until it is listed
   * here. `dispatch_agent` and the tools that wait for the viewer (`ask_choice`, `open_panel`,
   * `update_panel`) are never given, even when listed. With none of the listed tools there this reply,
   * `dispatch_agent` is not offered.
   */
  tools: readonly string[];
  /** Rules for subagents, added after the built-in ones and the subagent rules. */
  instructions?: string;
  /** The model id subagents use; the reply's own model unless set. */
  model?: string;
  /** Subagents running at once; the next is refused (default 3). */
  maxLive?: number;
  /** Subagents one reply may start; the next is refused (default 8). */
  maxPerReply?: number;
  /** Steps (model requests) one subagent may take, the last one in words (default 30). */
  maxSteps?: number;
  /** Tool calls one subagent may make; the next one ends it, as `ran_out` (default 40). */
  maxToolCalls?: number;
}

export const SUBAGENT_DEFAULTS = { maxLive: 3, maxPerReply: 8, maxSteps: 30, maxToolCalls: 40 } as const;
/** Kept within these, so a typo cannot start a hundred subagents or none. */
const BOUNDS = { maxLive: [1, 10], maxPerReply: [1, 50], maxSteps: [2, 200], maxToolCalls: [1, 500] } as const;

/** Never given to a subagent, whatever the allowlist says: no recursion, and nothing that waits for the viewer. */
export const NEVER_FOR_SUBAGENTS: ReadonlySet<string> = new Set([DISPATCH_AGENT, ASK_CHOICE, OPEN_PANEL, UPDATE_PANEL]);

const ARG_MAX = 80;
/** A subagent's own retry budget for a dropped connection: a cut step with no tool call is asked again once. */
export const SUBAGENT_NETWORK_RETRIES = 1;

export const WRITE_UNAVAILABLE = 'write subagents are not available yet';
const REFUSED_NOTE = 'Nothing ran. Do the work yourself, or dispatch it again later as a read task.';

export const SUBAGENT_PREAMBLE = [
  'You are a subagent. Another assistant gave you the task in the user message and reads what you return; the user never sees your words.',
  '- You cannot talk to the user or ask anyone anything. Do not ask questions: decide, or say what you could not find out.',
  '- Stay read-only: look things up and read. Never create, change, delete, post, generate or spend anything.',
  '- Finish with what you found, in at most 200 words: the answer first, then what it rests on (files, pages, names), then anything you could not find out.',
].join('\n');

const LAST_STEP = 'This is your last step: you cannot call tools now. Write what you found so far, in at most 200 words, and say what you could not finish.';

/** The caps and allowlist one reply uses, with the page's values kept in bounds. */
export interface ResolvedSubagents {
  tools: readonly string[];
  instructions?: string;
  model?: string;
  maxLive: number;
  maxPerReply: number;
  maxSteps: number;
  maxToolCalls: number;
}

/** The page's options as a reply uses them, or `undefined` when subagents are off. */
export function resolveSubagents(options: ChatSubagents | undefined | null): ResolvedSubagents | undefined {
  if (!options || !Array.isArray(options.tools) || options.tools.length === 0) return undefined;
  const cap = (key: keyof typeof BOUNDS): number => {
    const value = options[key];
    const [min, max] = BOUNDS[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : SUBAGENT_DEFAULTS[key];
  };
  const model = options.model?.trim();
  const instructions = options.instructions?.trim();
  return {
    tools: options.tools.filter((name): name is string => typeof name === 'string'),
    ...(instructions ? { instructions } : {}),
    ...(model ? { model } : {}),
    maxLive: cap('maxLive'),
    maxPerReply: cap('maxPerReply'),
    maxSteps: cap('maxSteps'),
    maxToolCalls: cap('maxToolCalls'),
  };
}

/** The tools a subagent gets: the allowlisted ones this reply has, never {@link NEVER_FOR_SUBAGENTS}, in allowlist order. */
export function subagentToolNames(allowlist: readonly string[], available: ToolSet): string[] {
  return [...new Set(allowlist)].filter((name) => Object.hasOwn(available, name) && !NEVER_FOR_SUBAGENTS.has(name));
}

/** A subagent's live progress, for its card while the call runs. */
export interface SubagentProgress {
  task: string;
  steps: number;
  toolCalls: number;
  lastTool?: string;
}

/** The subagents running in this session, by the `dispatch_agent` call's id; fires `change`. */
export class SubagentTracker extends EventTarget {
  #live = new Map<string, SubagentProgress>();

  get(id: string): SubagentProgress | undefined {
    return this.#live.get(id);
  }

  set(id: string, progress: SubagentProgress | undefined): void {
    if (progress) this.#live.set(id, progress);
    else this.#live.delete(id);
    this.dispatchEvent(new Event('change'));
  }
}

export interface DispatchDeps {
  options: ResolvedSubagents;
  /** The reply's tools, before the page's gate. */
  tools: ToolSet;
  /** `tools` behind the page's gate as one subagent's calls: the reply's own `reply`, and `subagent` set. */
  gate(tools: ToolSet, subagent: string): ToolSet;
  /** The model subagents use. */
  model(): LanguageModel;
  maxOutputTokens(): number;
  now?(): Date;
  describeError?(error: unknown): HumanError;
  networkRetryDelaysMs?: readonly number[];
  progress?: SubagentTracker;
}

/**
 * `dispatch_agent` for one reply. Its caps on subagents at once and per reply are this reply's: built
 * once per reply, like the reply's tools. Admission is decided before anything awaits, so calls made
 * together are admitted in the order they start.
 */
export function dispatchAgentTool(deps: DispatchDeps): Tool {
  const { options } = deps;
  const names = subagentToolNames(options.tools, deps.tools);
  let live = 0;
  let started = 0;
  return dynamicTool({
    description: [
      'Start a read-only subagent: another assistant that works on one research task in its own context with read-only tools, and gives you back only a short summary of what it found, never what it read.',
      'Use it when you need a conclusion drawn from many files or pages ("how does X work?", "which files use Y?"), not their contents; do small lookups yourself.',
      `Several calls in one step run at the same time: at most ${options.maxLive} at once and ${options.maxPerReply} per reply.`,
      'It sees nothing of this chat: write task as a self-contained brief naming what to look at, what to find out and what to return. mode must be "read".',
    ].join(' '),
    inputSchema: jsonSchema<{ task: string; mode: string }>({
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A self-contained brief: what to look at, what to find out, what to return.' },
        mode: { type: 'string', description: 'Only "read" is available.' },
      },
      required: ['task', 'mode'],
      additionalProperties: false,
    }),
    execute: async (input, { toolCallId, abortSignal }) => {
      const { task, mode } = (input ?? {}) as { task?: unknown; mode?: unknown };
      if (mode === 'write') return { error: WRITE_UNAVAILABLE, note: REFUSED_NOTE };
      if (mode !== 'read') return { error: 'mode must be "read".', note: REFUSED_NOTE };
      if (typeof task !== 'string' || task.trim() === '') return { error: 'task is empty: write a self-contained brief.', note: REFUSED_NOTE };
      if (started >= options.maxPerReply) return { error: `This reply already started ${options.maxPerReply} subagents, the most one reply may.`, note: REFUSED_NOTE };
      if (live >= options.maxLive) return { error: `${options.maxLive} subagents are already running, the most at once. Dispatch this after one returns.`, note: REFUSED_NOTE };
      live++;
      started++;
      try {
        return await runChild(deps, names, task.trim(), toolCallId, abortSignal);
      } finally {
        live--;
      }
    },
  });
}

/** One subagent, start to end. Its tools are the allowlisted ones, behind the page's gate and its own call cap. */
async function runChild(deps: DispatchDeps, names: string[], task: string, id: string, signal: AbortSignal | undefined): Promise<SubagentResult> {
  const { options } = deps;
  const activity: SubagentResult['activity'] = [];
  let calls = 0;
  const progress: SubagentProgress = { task, steps: 0, toolCalls: 0 };
  const report = () => deps.progress?.set(id, { ...progress });
  if (signal?.aborted) return { status: 'stopped', summary: '', steps: 0, toolCalls: 0, activity };

  const gated = deps.gate(Object.fromEntries(names.map((name) => [name, deps.tools[name]!])), id);
  const tools: ToolSet = {};
  for (const [name, tool] of Object.entries(gated)) {
    const execute = tool.execute;
    if (!execute) continue;
    tools[name] = {
      ...tool,
      execute: async (input: unknown, callOptions: Parameters<typeof execute>[1]) => {
        // Over the cap: nothing runs, the page is not asked, and the subagent takes no further step.
        if (calls >= options.maxToolCalls) {
          const message = `This subagent used its ${options.maxToolCalls} tool calls.`;
          return endingOutput({ error: message, note: 'Nothing ran. Write what you found so far.' }, message);
        }
        calls++;
        if (activity.length < ACTIVITY_MAX) activity.push({ tool: name, arg: shortArg(input) });
        progress.toolCalls = calls;
        progress.lastTool = name;
        report();
        const output = await (execute as (input: unknown, options: unknown) => unknown)(input, callOptions);
        // A tool that waits for the viewer would end the subagent with a card nobody sees.
        if ((output as { awaitsUser?: unknown } | null)?.awaitsUser === true) return { error: 'This tool needs the user, and a subagent cannot reach them.' };
        return output;
      },
    } as typeof tool;
  }

  const core = new AgentCore({ describeError: (error) => (deps.describeError ?? humanize)(error) });
  const stop = () => core.abort();
  signal?.addEventListener('abort', stop, { once: true });
  report();
  let outcome: AgentCoreOutcome | undefined;
  try {
    const system = subagentSystemPrompt(names, deps.now?.() ?? new Date(), options.instructions);
    outcome = await core.run({
      seq: 0,
      tools: async () => tools,
      request: () => ({
        model: deps.model(),
        system,
        history: [{ role: 'user', content: `Your task:\n\n${task}` }],
        maxOutputTokens: deps.maxOutputTokens(),
        maxSteps: options.maxSteps,
        lastStep: LAST_STEP,
        maxNetworkRetries: SUBAGENT_NETWORK_RETRIES,
        ...(deps.networkRetryDelaysMs ? { networkRetryDelaysMs: deps.networkRetryDelaysMs } : {}),
      }),
      stepFinished: ({ steps }) => {
        progress.steps = steps;
        report();
      },
    });
  } finally {
    signal?.removeEventListener('abort', stop);
    deps.progress?.set(id, undefined);
  }
  return resultOf(outcome!, Math.min(calls, options.maxToolCalls), activity, deps.describeError ?? humanize);
}

function resultOf(outcome: AgentCoreOutcome, toolCalls: number, activity: SubagentResult['activity'], describe: (error: unknown) => HumanError): SubagentResult {
  const status: SubagentStatus =
    outcome.status === 'aborted' ? 'stopped' : outcome.status === 'error' ? 'error' : outcome.ranOut || outcome.stopped !== undefined ? 'ran_out' : 'done';
  return {
    status,
    summary: finalWords(outcome.messages).slice(0, SUMMARY_MAX_CHARS),
    steps: outcome.steps,
    toolCalls,
    activity,
    ...(status === 'error' ? { error: describe(outcome.error).message } : {}),
  };
}

/** The words of the last assistant message that has any. */
export function finalWords(messages: ModelMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'assistant') continue;
    const text = typeof message.content === 'string' ? message.content : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
    if (text.trim() !== '') return text.trim();
  }
  return '';
}

/** A call's input as one short argument: a path, URL or query when it has one, else its summary. */
function shortArg(input: unknown): string {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
  const key = ['path', 'file', 'url', 'query', 'pattern', 'dir', 'name', 'id'].find((k) => typeof record?.[k] === 'string');
  const line = key ? String(record![key]).replace(/\s+/g, ' ').trim() : summarizeInput(input);
  return line.length > ARG_MAX ? `${line.slice(0, ARG_MAX - 1)}…` : line;
}

/** The chat's built-in rules for the subagent's tools, the subagent rules, then the page's. */
export function subagentSystemPrompt(tools: string[], now: Date, instructions?: string): string {
  return [
    defaultRules({ tools }),
    '',
    `Today is ${now.toISOString().slice(0, 10)}.`,
    '',
    'These rules come after the ones above and win where they differ:',
    SUBAGENT_PREAMBLE,
    ...(instructions ? ['', 'The app adds these rules for subagents:', '<subagent_instructions>', instructions, '</subagent_instructions>'] : []),
  ].join('\n');
}

