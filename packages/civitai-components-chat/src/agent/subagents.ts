import { dynamicTool, jsonSchema, type LanguageModel, type ModelMessage, type Tool, type ToolSet } from 'ai';

import { CLOSE_PANEL, OPEN_PANEL, UPDATE_PANEL } from '../panels/tools.js';
import { ASK_CHOICE } from '../tools/build.js';
import { isErrorOutput } from '../tools/gate.js';
import { humanize, type HumanError } from '../ux/humanize.js';
import { AgentCore, type AgentCoreOutcome } from './core.js';
import { defaultRules } from './system-prompt.js';
import {
  ACTIVITY_MAX,
  DISPATCH_AGENT,
  SUBAGENT_KIND,
  SUMMARY_MAX_CHARS,
  type SubagentChange,
  type SubagentCheckpoint,
  type SubagentRefusal,
  type SubagentResult,
  type SubagentStatus,
} from './subagent-result.js';
import { summarizeInput } from './tool-groups.js';

export {
  ACTIVITY_MAX,
  DISPATCH_AGENT,
  SUBAGENT_INTERRUPTED,
  SUBAGENT_KIND,
  SUMMARY_MAX_CHARS,
  interruptedSubagent,
  isSubagentOutput,
  subagentResultOf,
  type SubagentChange,
  type SubagentCheckpoint,
  type SubagentRefusal,
  type SubagentResult,
  type SubagentStatus,
} from './subagent-result.js';

/**
 * Subagents: the `dispatch_agent` tool. Its call runs a child reply on {@link AgentCore} with a history of
 * its own (only the task), an allowlisted subset of the reply's tools, and its own step and tool-call
 * caps, and gives the parent back a short result built by the chat, never the child's transcript. Read
 * subagents are off unless the page opts in with {@link ChatSubagents}; write subagents also need
 * {@link ChatSubagents.write}.
 */

/** How a write subagent's call to one file tool says which file it changed. */
export interface ChatSubagentFileTool {
  /** What the tool does to the file, as the parent reads it in `changed` (`write`, `edit`, `delete`, …). */
  op: string;
  /**
   * Where the file's path is in the call's input: the name of an input field (`path` unless set), or a
   * function that returns it. A call whose path does not read as a non-empty string is not listed.
   */
  path?: string | ((input: unknown) => string | undefined);
}

/**
 * The page's opt-in to write subagents: subagents that may change things, given their own allowlist.
 * Concurrent write subagents are not kept apart: two may edit the same file at the same time.
 */
export interface ChatWriteSubagents {
  /**
   * The tools a write subagent may use, by the exact name the assistant sees; any tool, a free-form
   * command tool included. Only these: list the read tools it needs here too. The same tools are never
   * given as for read subagents (`dispatch_agent`, `ask_choice`, `open_panel`, `update_panel`).
   * With none of the listed tools there this reply, `mode: "write"` is refused.
   */
  tools: readonly string[];
  /** Rules for write subagents, added after the built-in ones and the write rules (instead of `instructions`). */
  instructions?: string;
  /**
   * The tools that change files, by name, and how to read the file from a call's input. A successful
   * result of one of these (one that is not an error) puts `{ path, op }` in the result's `changed`.
   * Nothing else does: not a failed call, not another tool, and never what the subagent says.
   */
  files?: Readonly<Record<string, ChatSubagentFileTool>>;
  /** The tools that run commands; each call that runs is counted in `ranCommands` (what it changed is not in `changed`). */
  commands?: readonly string[];
}

/** The page's opt-in. Without it `dispatch_agent` is not offered at all. Read at the start of every reply. */
export interface ChatSubagents {
  /**
   * The tools a read subagent may use, by the exact name the assistant sees (an added server's as
   * `${id}__${tool}`). An allowlist: a tool added later is not given to subagents until it is listed
   * here. `dispatch_agent` and the tools that wait for the viewer (`ask_choice`, `open_panel`,
   * `update_panel`) are never given, even when listed. With none of the listed tools there this reply
   * (and no write subagents), `dispatch_agent` is not offered.
   */
  tools: readonly string[];
  /** Rules for read subagents, added after the built-in ones and the subagent rules. */
  instructions?: string;
  /** Write subagents (`mode: "write"`); refused unless set. */
  write?: ChatWriteSubagents;
  /** The model id subagents use; the reply's own model unless set. */
  model?: string;
  /** Subagents running at once, read and write together; the next is refused (default 3). */
  maxLive?: number;
  /** Subagents one reply may start, read and write together; the next is refused (default 8). */
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
export const NEVER_FOR_SUBAGENTS: ReadonlySet<string> = new Set([DISPATCH_AGENT, ASK_CHOICE, OPEN_PANEL, UPDATE_PANEL, CLOSE_PANEL]);

const ARG_MAX = 80;
/** A subagent's own retry budget for a dropped connection: a cut step with no tool call is asked again once. */
export const SUBAGENT_NETWORK_RETRIES = 1;

export const WRITE_UNAVAILABLE = 'write subagents are not available yet';
const READ_UNAVAILABLE = 'read subagents are not available: no read tool is allowed this reply.';
const REFUSED_NOTE = 'Nothing ran. Do the work yourself, or dispatch it again later as a read task.';

const OPENING = [
  'You are a subagent. Another assistant gave you the task in the user message and reads what you return; the user never sees your words.',
];

export const SUBAGENT_PREAMBLE = [
  ...OPENING,
  '- You cannot talk to the user or ask anyone anything. Do not ask questions: decide, or say what you could not find out.',
  '- Stay read-only: look things up and read. Never create, change, delete, post, generate or spend anything.',
  '- Finish with what you found, in at most 200 words: the answer first, then what it rests on (files, pages, names), then anything you could not find out.',
].join('\n');

export const SUBAGENT_WRITE_PREAMBLE = [
  ...OPENING,
  '- You cannot talk to the user or ask anyone anything. Do not ask questions: decide, or say what you could not do.',
  '- You may edit files and run commands to do the task. Do only the task.',
  '- Another subagent may be editing files at the same time: keep each edit small, and read a file again right before you edit it.',
  '- Finish with, in at most 200 words: what you changed, what you ran, and what you could not do.',
].join('\n');

const LAST_STEP = 'This is your last step: you cannot call tools now. Write what you found so far, in at most 200 words, and say what you could not finish.';
const LAST_STEP_WRITE = 'This is your last step: you cannot call tools now. In at most 200 words, write what you changed, what you ran, and what you could not finish.';

/** The write opt-in as a reply uses it. */
export interface ResolvedWriteSubagents {
  tools: readonly string[];
  instructions?: string;
  files: ReadonlyMap<string, ChatSubagentFileTool>;
  commands: ReadonlySet<string>;
}

/** The caps and allowlists one reply uses, with the page's values kept in bounds. */
export interface ResolvedSubagents {
  tools: readonly string[];
  instructions?: string;
  write?: ResolvedWriteSubagents;
  model?: string;
  maxLive: number;
  maxPerReply: number;
  maxSteps: number;
  maxToolCalls: number;
}

const strings = (list: unknown): string[] => (Array.isArray(list) ? list.filter((name): name is string => typeof name === 'string') : []);

function resolveWrite(write: ChatWriteSubagents | undefined | null): ResolvedWriteSubagents | undefined {
  if (!write || typeof write !== 'object') return undefined;
  const tools = strings(write.tools);
  if (tools.length === 0) return undefined;
  const files = new Map<string, ChatSubagentFileTool>();
  for (const [name, file] of Object.entries(write.files ?? {})) {
    if (file && typeof file === 'object' && typeof file.op === 'string' && file.op.trim() !== '') files.set(name, { op: file.op.trim(), ...(file.path !== undefined ? { path: file.path } : {}) });
  }
  const instructions = write.instructions?.trim();
  return { tools, ...(instructions ? { instructions } : {}), files, commands: new Set(strings(write.commands)) };
}

/** The page's options as a reply uses them, or `undefined` when subagents are off. */
export function resolveSubagents(options: ChatSubagents | undefined | null): ResolvedSubagents | undefined {
  if (!options) return undefined;
  const tools = strings(options.tools);
  const write = resolveWrite(options.write);
  if (tools.length === 0 && !write) return undefined;
  const cap = (key: keyof typeof BOUNDS): number => {
    const value = options[key];
    const [min, max] = BOUNDS[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : SUBAGENT_DEFAULTS[key];
  };
  const model = options.model?.trim();
  const instructions = options.instructions?.trim();
  return {
    tools,
    ...(instructions ? { instructions } : {}),
    ...(write ? { write } : {}),
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

/** Whether a reply with these tools offers `dispatch_agent`: a read or a write subagent would get at least one tool. */
export function offersDispatch(options: ResolvedSubagents, available: ToolSet): boolean {
  return subagentToolNames(options.tools, available).length > 0 || (options.write !== undefined && subagentToolNames(options.write.tools, available).length > 0);
}

/** A subagent's live progress, for its card while the call runs. */
export interface SubagentProgress {
  task: string;
  steps: number;
  toolCalls: number;
  lastTool?: string;
  /** Set only for a write subagent, with its files changed so far (distinct paths) and commands run. */
  mode?: 'write';
  changed?: number;
  ranCommands?: number;
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
  /** Aborts when the page ends the reply (`stop: true` on one of the reply's own calls): every subagent stops. */
  ended?: AbortSignal;
  /**
   * Saves what a write subagent has done so far with the reply's progress (as it starts, after each of
   * its file or command calls, and after each of its steps), so a page that closes while it runs hands
   * Continue its `changed` list. Read subagents are not saved.
   */
  checkpoint?(id: string, progress: SubagentCheckpoint): void;
}

/**
 * `dispatch_agent` for one reply. Its caps on subagents at once and per reply are this reply's: built
 * once per reply, like the reply's tools. Admission is decided before anything awaits, so calls made
 * together are admitted in the order they start.
 */
export function dispatchAgentTool(deps: DispatchDeps): Tool {
  const { options } = deps;
  const readNames = subagentToolNames(options.tools, deps.tools);
  const writeNames = options.write ? subagentToolNames(options.write.tools, deps.tools) : [];
  const canWrite = writeNames.length > 0;
  const modes = [...(readNames.length > 0 ? ['"read"'] : []), ...(canWrite ? ['"write"'] : [])];
  let live = 0;
  let started = 0;
  return dynamicTool({
    description: (canWrite ? writeDescription(options, readNames.length > 0, modes) : readDescription(options)).join(' '),
    inputSchema: jsonSchema<{ task: string; mode: string }>({
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A self-contained brief: what to look at, what to find out, what to return.' },
        mode: { type: 'string', description: canWrite ? `${modes.join(' or ')}.` : 'Only "read" is available.' },
      },
      required: ['task', 'mode'],
      additionalProperties: false,
    }),
    execute: async (input, { toolCallId, abortSignal }) => {
      const { task, mode } = (input ?? {}) as { task?: unknown; mode?: unknown };
      if (mode === 'write' && !canWrite) return refusal(WRITE_UNAVAILABLE);
      if (mode !== 'read' && mode !== 'write') return refusal(canWrite ? `mode must be ${modes.join(' or ')}.` : 'mode must be "read".');
      if (mode === 'read' && readNames.length === 0) return refusal(READ_UNAVAILABLE);
      if (typeof task !== 'string' || task.trim() === '') return refusal('task is empty: write a self-contained brief.');
      if (started >= options.maxPerReply) return refusal(`This reply already started ${options.maxPerReply} subagents, the most one reply may.`);
      if (live >= options.maxLive) return refusal(`${options.maxLive} subagents are already running, the most at once. Dispatch this after one returns.`);
      live++;
      started++;
      try {
        return await runChild(deps, mode === 'write' ? writeNames : readNames, task.trim(), toolCallId, abortSignal, mode === 'write' ? options.write : undefined);
      } finally {
        live--;
      }
    },
  });
}

/** The read-only tool's description, word for word as before write subagents. */
function readDescription(options: ResolvedSubagents): string[] {
  return [
    'Start a read-only subagent: another assistant that works on one research task in its own context with read-only tools, and gives you back only a short summary of what it found, never what it read.',
    'Use it when you need a conclusion drawn from many files or pages ("how does X work?", "which files use Y?"), not their contents; do small lookups yourself.',
    `Several calls in one step run at the same time: at most ${options.maxLive} at once and ${options.maxPerReply} per reply.`,
    'It sees nothing of this chat: write task as a self-contained brief naming what to look at, what to find out and what to return. mode must be "read".',
  ];
}

function writeDescription(options: ResolvedSubagents, canRead: boolean, modes: string[]): string[] {
  return [
    'Start a subagent: another assistant that works on one task in its own context and gives you back only a short summary, never what it read.',
    ...(canRead ? ['mode "read" researches with read-only tools: use it when you need a conclusion drawn from many files or pages ("how does X work?", "which files use Y?"), not their contents; do small lookups yourself.'] : []),
    'mode "write" may edit files and run commands: use it for a separate piece of work that needs many tool calls. Write subagents running at the same time may edit the same files, so give each its own files.',
    'A write subagent\'s result lists changed (the files its file tools changed) and ranCommands (the commands it ran; what those changed is not listed): read what it changed and run your checks again before you rely on it.',
    `Several calls in one step run at the same time: at most ${options.maxLive} at once and ${options.maxPerReply} per reply.`,
    `It sees nothing of this chat: write task as a self-contained brief naming what to look at, what to do and what to return. mode must be ${modes.join(' or ')}.`,
  ];
}

/** A `dispatch_agent` call that started no subagent, marked as the chat's own. */
function refusal(error: string): SubagentRefusal {
  return { kind: SUBAGENT_KIND, error, note: REFUSED_NOTE };
}

/**
 * One subagent, start to end. Its tools are the allowlisted ones, behind the page's gate and its own call
 * cap. A write subagent's file and command tools are recorded inside the gate, so only a call the page
 * let run counts, and a file change only from that call's successful result.
 */
async function runChild(deps: DispatchDeps, names: string[], task: string, id: string, signal: AbortSignal | undefined, write: ResolvedWriteSubagents | undefined): Promise<SubagentResult> {
  const { options } = deps;
  const activity: SubagentResult['activity'] = [];
  let calls = 0;
  const changed: SubagentChange[] = [];
  let ranCommands = 0;
  const progress: SubagentProgress = { task, steps: 0, toolCalls: 0, ...(write ? { mode: 'write' as const, changed: 0, ranCommands: 0 } : {}) };
  const report = () => deps.progress?.set(id, { ...progress });
  const save = () => {
    if (!write) return;
    progress.changed = new Set(changed.map((change) => change.path)).size;
    progress.ranCommands = ranCommands;
    deps.checkpoint?.(id, { mode: 'write', steps: progress.steps, toolCalls: calls, activity: [...activity], changed: [...changed], ranCommands });
  };
  // The reply stopped by the viewer, or ended by the page: the subagent stops either way.
  const signals = [signal, deps.ended].filter((s): s is AbortSignal => s !== undefined);
  if (signals.some((s) => s.aborted)) return { kind: SUBAGENT_KIND, status: 'stopped', summary: '', steps: 0, toolCalls: 0, activity, ...(write ? { mode: 'write' as const, changed, ranCommands } : {}) };
  // Set once the tool-call cap is reached: no call runs after it, and the next step is the last, in words.
  let capped = false;

  const own: ToolSet = {};
  for (const name of names) {
    const tool = deps.tools[name]!;
    const execute = tool.execute;
    const file = write?.files.get(name);
    const command = write?.commands.has(name) ?? false;
    own[name] =
      !execute || (!file && !command)
        ? tool
        : ({
            ...tool,
            execute: async (input: unknown, callOptions: Parameters<typeof execute>[1]) => {
              if (command) {
                ranCommands++;
                save();
                report();
              }
              const output = await (execute as (input: unknown, options: unknown) => unknown)(input, callOptions);
              if (file && !isErrorOutput(output) && (output as { awaitsUser?: unknown } | null)?.awaitsUser !== true) {
                const path = pathOf(file, input);
                if (path !== undefined && !changed.some((change) => change.path === path && change.op === file.op)) changed.push({ path, op: file.op });
                save();
                report();
              }
              return output;
            },
          } as typeof tool);
  }
  const gated = deps.gate(own, id);
  const tools: ToolSet = {};
  for (const [name, tool] of Object.entries(gated)) {
    const execute = tool.execute;
    if (!execute) continue;
    tools[name] = {
      ...tool,
      execute: async (input: unknown, callOptions: Parameters<typeof execute>[1]) => {
        // Over the cap: nothing runs, the page is not asked, and its next step is its last, in words.
        if (calls >= options.maxToolCalls) {
          capped = true;
          return { error: `This subagent used its ${options.maxToolCalls} tool calls.`, note: 'Nothing ran. Write what you found so far.' };
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
  for (const s of signals) s.addEventListener('abort', stop, { once: true });
  report();
  save();
  let outcome: AgentCoreOutcome | undefined;
  try {
    const system = subagentSystemPrompt(names, deps.now?.() ?? new Date(), write ? write.instructions : options.instructions, write ? 'write' : 'read');
    outcome = await core.run({
      seq: 0,
      tools: async () => tools,
      request: () => ({
        model: deps.model(),
        system,
        history: [{ role: 'user', content: `Your task:\n\n${task}` }],
        maxOutputTokens: deps.maxOutputTokens(),
        maxSteps: options.maxSteps,
        lastStep: write ? LAST_STEP_WRITE : LAST_STEP,
        wordsOnly: () => capped,
        maxNetworkRetries: SUBAGENT_NETWORK_RETRIES,
        ...(deps.networkRetryDelaysMs ? { networkRetryDelaysMs: deps.networkRetryDelaysMs } : {}),
      }),
      stepFinished: ({ steps }) => {
        progress.steps = steps;
        save();
        report();
      },
    });
  } finally {
    for (const s of signals) s.removeEventListener('abort', stop);
    deps.progress?.set(id, undefined);
  }
  const result = resultOf(outcome!, Math.min(calls, options.maxToolCalls), activity, capped, deps.describeError ?? humanize);
  return write ? { ...result, mode: 'write', changed, ranCommands } : result;
}

/** The file a file tool's call names, from the field the page named (`path` unless set) or its function. */
function pathOf(file: ChatSubagentFileTool, input: unknown): string | undefined {
  let value: unknown;
  if (typeof file.path === 'function') {
    try {
      value = file.path(input);
    } catch {
      return undefined;
    }
  } else {
    const record = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
    value = record?.[file.path ?? 'path'];
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function resultOf(outcome: AgentCoreOutcome, toolCalls: number, activity: SubagentResult['activity'], capped: boolean, describe: (error: unknown) => HumanError): SubagentResult {
  const status: SubagentStatus =
    outcome.status === 'aborted' ? 'stopped' : outcome.status === 'error' ? 'error' : capped || outcome.ranOut || outcome.stopped !== undefined ? 'ran_out' : 'done';
  return {
    kind: SUBAGENT_KIND,
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

/** The chat's built-in rules for the subagent's tools, the subagent rules for its mode, then the page's. */
export function subagentSystemPrompt(tools: string[], now: Date, instructions?: string, mode: 'read' | 'write' = 'read'): string {
  return [
    defaultRules({ tools }),
    '',
    `Today is ${now.toISOString().slice(0, 10)}.`,
    '',
    'These rules come after the ones above and win where they differ:',
    mode === 'write' ? SUBAGENT_WRITE_PREAMBLE : SUBAGENT_PREAMBLE,
    ...(instructions ? ['', 'The app adds these rules for subagents:', '<subagent_instructions>', instructions, '</subagent_instructions>'] : []),
  ].join('\n');
}
