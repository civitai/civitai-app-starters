import type {
  Workflow,
  WorkflowStatus,
  WorkflowTemplate,
} from '@civitai/orchestration-client/dist/generated/types.gen.js';

import { createCaller, type CallOptions } from '../core/messaging.js';
import { paginate } from '../core/paging.js';

import type { OrchestrationRequests, SpendLimit } from './protocol.js';

export type { SpendLimit } from './protocol.js';

const call = createCaller<OrchestrationRequests>();

const TERMINAL: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/**
 * Waits between consecutive failed reads, and so also how many are absorbed
 * before giving up. A blip should not end a generation; an outage should not be
 * hammered. Any successful read resets it.
 */
const RETRY_BACKOFF_MS = [250, 1_000, 4_000];

export interface SubmitOptions extends CallOptions, SpendLimit {}

export function isTerminal(workflow: Workflow): boolean {
  return TERMINAL.has(workflow.status);
}

export interface WorkflowQuery {
  /** Stop after this many. Defaults to 100; `Infinity` reads to the end. */
  limit?: number;
  /** Opaque; from a prior reply. */
  cursor?: string;
}

/**
 * What this app has submitted for this viewer, newest first, fetching the next
 * page only as you read into it. Stops after `limit` workflows — 100 unless you
 * say otherwise. The host scopes it to this app, so a workflow another app
 * submitted is never reachable here.
 */
export function listWorkflows(
  query: WorkflowQuery = {},
  opts: CallOptions = {},
): AsyncGenerator<Workflow> {
  return paginate(query.limit, 50, async (take, cursor) => {
    const page = await call('ORCHESTRATION_LIST_WORKFLOWS', { ...query, limit: take, cursor }, opts);
    return { items: page.workflows, cursor: page.cursor };
  }, query.cursor);
}

/**
 * Cost preview. A run that cannot proceed comes back as a `failed` workflow, so
 * a block can show a "top up Buzz" CTA instead of tearing down.
 */
export async function estimateWorkflow(
  workflow: WorkflowTemplate,
  opts: SubmitOptions,
): Promise<Workflow> {
  const { maxBuzz, ...rest } = opts;
  return call('ORCHESTRATION_ESTIMATE_WORKFLOW', { workflow, maxBuzz }, rest);
}

/**
 * Spends the viewer's Buzz. The workflow can already be terminal. Set
 * `workflow.externalId` to make a retry collapse onto the first submission
 * rather than charging twice.
 */
export async function submitWorkflow(
  workflow: WorkflowTemplate,
  opts: SubmitOptions,
): Promise<Workflow> {
  const { maxBuzz, ...rest } = opts;
  return call('ORCHESTRATION_SUBMIT_WORKFLOW', { workflow, maxBuzz }, rest);
}

/** A single read of the workflow's current state. */
export async function getWorkflow(workflowId: string, opts: CallOptions = {}): Promise<Workflow> {
  return call('ORCHESTRATION_GET_WORKFLOW', { workflowId }, opts);
}

/** Stops the work and refunds what the orchestrator has not spent. */
export async function cancelWorkflow(
  workflowId: string,
  opts: CallOptions = {},
): Promise<Workflow> {
  return call('ORCHESTRATION_CANCEL_WORKFLOW', { workflowId }, opts);
}

/**
 * Every state a running workflow passes through, ending at a terminal one.
 * `break` stops watching; it does NOT cancel — the Buzz is spent and the
 * orchestrator keeps running, so call `cancelWorkflow()` to stop the work.
 */
export async function* watchWorkflow(
  workflowId: string,
  opts: CallOptions = {},
): AsyncGenerator<Workflow> {
  let failures = 0;
  let previous = '';

  while (true) {
    let workflow: Workflow;
    try {
      workflow = await call('ORCHESTRATION_GET_WORKFLOW', { workflowId, wait: true }, opts);
      failures = 0;
    } catch (cause) {
      // A pod rolling or a network blip should not end a generation the caller
      // is still waiting on; a burst is absorbed, a sustained outage is not.
      const backoff = RETRY_BACKOFF_MS[failures];
      failures += 1;
      if (opts.signal?.aborted || backoff === undefined) throw cause;
      await pause(backoff, opts.signal);
      continue;
    }

    // Compared whole rather than by field: this package names nothing inside a
    // workflow, so anything the orchestrator adds counts as progress for free.
    const current = JSON.stringify(workflow);
    const changed = current !== previous;
    previous = current;

    if (changed) yield workflow;
    if (isTerminal(workflow)) return;
  }
}

/**
 * Submit and settle: resolves with the finished workflow, however it finished.
 * A failed run resolves too — `status` says which. For progress, submit and
 * watch the id yourself.
 */
export async function runWorkflow(
  workflow: WorkflowTemplate,
  opts: SubmitOptions,
): Promise<Workflow> {
  const submitted = await submitWorkflow(workflow, opts);
  if (isTerminal(submitted) || !submitted.id) return submitted;

  let latest = submitted;
  for await (const next of watchWorkflow(submitted.id, opts)) latest = next;
  return latest;
}

/** Wakes early on abort, so cancelling never waits out the backoff. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
