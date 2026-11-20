/**
 * What a `dispatch_agent` call gives back, with nothing else in this file: the thread, the Buzz badge and
 * the store (an interrupted write subagent) read it from saved replies, and they load before (and
 * without) the agent.
 */

/** The tool the parent calls to start a subagent. */
export const DISPATCH_AGENT = 'dispatch_agent';

/** The most of a subagent's final words the parent gets back. */
export const SUMMARY_MAX_CHARS = 4_000;
/** The most entries of a subagent's activity the parent (and the card) gets back. */
export const ACTIVITY_MAX = 50;

/**
 * On every output of the chat's own `dispatch_agent`, a result or a refusal: a page tool of that name
 * (offered while subagents are off) is not drawn as a subagent or counted in the Buzz badge.
 */
export const SUBAGENT_KIND = 'subagent';

/**
 * `interrupted`: a write subagent whose page closed while it ran, read back on Continue; it was not run
 * again. `unreceived`: a subagent of a reply run on a server runner that ended on the page before its
 * result came (it may have finished there).
 */
export type SubagentStatus = 'done' | 'ran_out' | 'stopped' | 'error' | 'interrupted' | 'unreceived';

/** One file a write subagent's file tool changed, from that call's successful result. */
export interface SubagentChange {
  path: string;
  /** What the page says the tool does (`write`, `edit`, `delete`, …). */
  op: string;
}

/** What the parent gets back from `dispatch_agent`, and what the card shows after a reload. */
export interface SubagentResult {
  kind: typeof SUBAGENT_KIND;
  status: SubagentStatus;
  /** The subagent's final words, cut to {@link SUMMARY_MAX_CHARS}. */
  summary: string;
  /** Steps (model requests) it took. */
  steps: number;
  /** Tool calls it made (those its cap let through). */
  toolCalls: number;
  /** Each call: the tool and a short argument, no output; at most {@link ACTIVITY_MAX}. */
  activity: { tool: string; arg: string }[];
  error?: string;
  /** Set only on a write subagent's result. */
  mode?: 'write';
  /**
   * A write subagent's file changes: one entry per path and op, from the successful results of the
   * tools the page marked as file tools, never from the subagent's words.
   */
  changed?: SubagentChange[];
  /** A write subagent's calls to the page's command tools that ran; what they changed is not in `changed`. */
  ranCommands?: number;
  /**
   * Set only on an `unreceived` write subagent: how many files it had changed when last seen. Their
   * paths never reached the page, so `changed` is empty.
   */
  changedCount?: number;
}

/** A `dispatch_agent` call the chat refused: nothing ran. */
export interface SubagentRefusal {
  kind: typeof SUBAGENT_KIND;
  error: string;
  note: string;
}

/** Whether a `dispatch_agent` output came from the chat's own tool (a result or a refusal). */
export function isSubagentOutput(output: unknown): output is SubagentResult | SubagentRefusal {
  return output !== null && typeof output === 'object' && (output as { kind?: unknown }).kind === SUBAGENT_KIND;
}

/** A persisted `dispatch_agent` output, when it is the chat's own subagent's result (not a refusal). */
export function subagentResultOf(output: unknown): SubagentResult | undefined {
  if (!isSubagentOutput(output)) return undefined;
  const value = output as Partial<SubagentResult>;
  return typeof value.status === 'string' && typeof value.steps === 'number' ? (value as SubagentResult) : undefined;
}

/**
 * A running write subagent as saved with its reply's progress (see `checkpoint`): what it had done by
 * then. Read back only for a `dispatch_agent` call that has no result, to build {@link interruptedSubagent}.
 */
export interface SubagentCheckpoint {
  mode: 'write';
  steps: number;
  toolCalls: number;
  activity: { tool: string; arg: string }[];
  changed: SubagentChange[];
  ranCommands: number;
}

export const SUBAGENT_INTERRUPTED =
  'interrupted: the page closed while this write subagent ran, and it was not run again. changed lists the files it had changed by then (it may have changed more); check them before you redo the work.';

/** The result a write subagent that did not finish is given on Continue, from its latest checkpoint. */
export function interruptedSubagent(saved: unknown): SubagentResult | undefined {
  const value = saved as Partial<SubagentCheckpoint> | null | undefined;
  if (!value || typeof value !== 'object' || value.mode !== 'write') return undefined;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  const changed = Array.isArray(value.changed) ? value.changed.filter((c): c is SubagentChange => typeof c?.path === 'string' && typeof c?.op === 'string').map(({ path, op }) => ({ path, op })) : [];
  const activity = Array.isArray(value.activity) ? value.activity.filter((a) => typeof a?.tool === 'string').slice(0, ACTIVITY_MAX).map(({ tool, arg }) => ({ tool, arg: String(arg ?? '') })) : [];
  return {
    kind: SUBAGENT_KIND,
    mode: 'write',
    status: 'interrupted',
    summary: '',
    steps: count(value.steps),
    toolCalls: count(value.toolCalls),
    activity,
    changed,
    ranCommands: count(value.ranCommands),
    error: SUBAGENT_INTERRUPTED,
  };
}
