import {
  getWorkflow as sdkGetWorkflow,
  submitWorkflow as sdkSubmitWorkflow,
  type GetWorkflowData,
  type SubmitWorkflowData,
  type Workflow,
} from '@civitai/client';
import type { AppClient } from '../client/index.js';

/**
 * Thin wrappers around the orchestrator's workflow endpoints with conventions
 * suited to third-party app starters. All calls use the user's OAuth token
 * (or API key) carried by the `AppClient` — the orchestrator debits Buzz
 * from whoever owns that token.
 */

export type WorkflowBody = NonNullable<SubmitWorkflowData['body']>;

export interface CostEstimate {
  /** Buzz cost. Pulled from the workflow's `cost.total` field. */
  total: number;
  /** Full workflow response (validation result, queue placement, etc.). */
  raw: Workflow;
}

class WorkflowError extends Error {
  override readonly name = 'WorkflowError';
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly detail: unknown,
  ) {
    super(message);
  }
}

function unwrap<T>(result: { data?: T; error?: unknown; response?: Response }): T {
  if (result.error || !result.data) {
    const status = result.response?.status;
    const detail =
      result.error && typeof result.error === 'object' && 'detail' in result.error
        ? (result.error as { detail?: unknown }).detail
        : result.error;
    throw new WorkflowError(
      `Civitai workflow request failed${status ? ` (HTTP ${status})` : ''}`,
      status,
      detail,
    );
  }
  return result.data;
}

/**
 * Cost preview ("what if") — runs the workflow validation/pricing pipeline
 * without committing any Buzz. Use this to show the user "this will cost X
 * Buzz" before they confirm submission.
 *
 * NOTE: per Civitai's docs, `whatif=true` validates and prices but does not
 * apply per-app spending caps to the response — a successful whatif can still
 * be denied at submit time if the user has set tight caps or insufficient
 * funds. Treat `whatif` as "this is the price" not "this is approved."
 */
export async function estimateCost(client: AppClient, body: WorkflowBody): Promise<CostEstimate> {
  const result = await sdkSubmitWorkflow({
    client,
    body,
    query: { whatif: true },
  });
  const workflow = unwrap(result);
  return { total: workflow?.cost?.total ?? 0, raw: workflow };
}

/** Submit a workflow for real execution. Debits the token-owner's Buzz. */
export async function submitWorkflow(client: AppClient, body: WorkflowBody): Promise<Workflow> {
  const result = await sdkSubmitWorkflow({ client, body });
  return unwrap(result);
}

export async function getWorkflow(client: AppClient, workflowId: string): Promise<Workflow> {
  const result = await sdkGetWorkflow({
    client,
    path: { workflowId } as GetWorkflowData['path'],
  });
  return unwrap(result);
}

export interface PollWorkflowOptions {
  /** Polling interval in ms. Default 2000. */
  intervalMs?: number;
  /** Max total time to poll in ms. Default 5 minutes. */
  timeoutMs?: number;
  /** Optional progress callback fired on every poll tick. */
  onTick?: (snapshot: Workflow) => void;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

const TERMINAL_STATUSES = new Set(['Succeeded', 'Failed', 'Canceled']);

/**
 * Poll a workflow until it reaches a terminal status (`Succeeded`, `Failed`,
 * `Canceled`) or the timeout elapses. Returns the final snapshot.
 */
export async function pollWorkflow(
  client: AppClient,
  workflowId: string,
  opts: PollWorkflowOptions = {},
): Promise<Workflow> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeout;

  while (true) {
    if (opts.signal?.aborted) throw new Error('pollWorkflow aborted');
    const snapshot = await getWorkflow(client, workflowId);
    opts.onTick?.(snapshot);
    if (snapshot.status && TERMINAL_STATUSES.has(String(snapshot.status))) {
      return snapshot;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `pollWorkflow timed out after ${timeout}ms (last status: ${String(snapshot.status)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export { WorkflowError };
