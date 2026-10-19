/**
 * What a `dispatch_agent` call gives back, with nothing else in this file: the thread and the Buzz badge
 * read it from saved replies, and they load before (and without) the agent.
 */

/** The tool the parent calls to start a subagent. */
export const DISPATCH_AGENT = 'dispatch_agent';

/** The most of a subagent's final words the parent gets back. */
export const SUMMARY_MAX_CHARS = 4_000;
/** The most entries of a subagent's activity the parent (and the card) gets back. */
export const ACTIVITY_MAX = 50;

export type SubagentStatus = 'done' | 'ran_out' | 'stopped' | 'error';

/** What the parent gets back from `dispatch_agent`, and what the card shows after a reload. */
export interface SubagentResult {
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
}

/** A persisted `dispatch_agent` output, when it is a subagent's result (not a refusal). */
export function subagentResultOf(output: unknown): SubagentResult | undefined {
  const value = output as Partial<SubagentResult> | null | undefined;
  return value && typeof value === 'object' && typeof value.status === 'string' && typeof value.steps === 'number' ? (value as SubagentResult) : undefined;
}
