import type {
  Workflow as GeneratedWorkflow,
  WorkflowStatus,
  WorkflowTemplate as GeneratedWorkflowTemplate,
} from '@civitai/orchestration-client/dist/generated/types.gen.js';

import { ApiError, type Http } from '../http/index.js';

import type { Step, StepTemplate } from './steps.generated.js';

export type { Step, StepTemplate, WorkflowStatus };

/** What to run. `currencies` defaults server-side, so it is optional here. */
export type WorkflowTemplate = Omit<GeneratedWorkflowTemplate, 'steps' | 'currencies'> & {
  steps: StepTemplate[];
  currencies?: GeneratedWorkflowTemplate['currencies'];
};

export type Workflow = Omit<GeneratedWorkflow, 'steps'> & { readonly steps: Step[] };

export interface WorkflowPage {
  next: string;
  items: Workflow[];
}

export const DEFAULT_ORCHESTRATION_URL = 'https://orchestration.civitai.com';

const WORKFLOWS = 'v2/consumer/workflows';

const TERMINAL: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/** How long the orchestrator holds each read while watching, in seconds. */
const HELD_READ_SECONDS = 20;

/** Waits between consecutive failed reads while watching; a success resets it. */
const RETRY_BACKOFF_MS = [250, 1_000, 4_000];

export interface CallOptions {
  signal?: AbortSignal;
}

export interface WaitOptions extends CallOptions {
  /** Seconds the orchestrator may hold the reply. */
  wait?: number;
  /** What ends the hold early: the workflow finishing (the default), or any change to it. */
  until?: 'completion' | 'change';
}

export interface WorkflowQuery {
  cursor?: string;
  take?: number;
  tags?: string[];
  excludeFailed?: boolean;
}

/**
 * Workflows on the orchestrator, as the viewer. Steps are the orchestrator's
 * own `WorkflowStepTemplate`s, so a step type it gains needs no release here.
 */
export interface OrchestrationClient {
  submitWorkflow(template: WorkflowTemplate, opts?: WaitOptions): Promise<Workflow>;
  /** Prices a workflow without running it. */
  estimateWorkflow(template: WorkflowTemplate, opts?: CallOptions): Promise<Workflow>;
  getWorkflow(workflowId: string, opts?: WaitOptions): Promise<Workflow>;
  /**
   * Yields the workflow now and again each time it changes, ending at a final
   * status. Break out of the loop to stop watching.
   */
  watchWorkflow(workflowId: string, opts?: CallOptions): AsyncGenerator<Workflow, void, undefined>;
  /** Resolves once the workflow reaches a final status, whichever it is. */
  waitForWorkflow(workflowId: string, opts?: CallOptions): Promise<Workflow>;
  cancelWorkflow(workflowId: string, opts?: CallOptions): Promise<void>;
  queryWorkflows(query?: WorkflowQuery, opts?: CallOptions): Promise<WorkflowPage>;
}

export function isTerminal(workflow: Workflow): boolean {
  return isTerminalStatus(workflow.status);
}

/** True once nothing more will happen to a workflow, or to one of its steps. */
export function isTerminalStatus(status: WorkflowStatus): boolean {
  return TERMINAL.has(status);
}

export function createOrchestrationClient(http: Http): OrchestrationClient {
  const getWorkflow = (workflowId: string, { wait, until, signal }: WaitOptions = {}) =>
    http<Workflow>('GET', `${WORKFLOWS}/${encodeURIComponent(workflowId)}`, {
      query: { wait, until },
      signal,
    });

  async function* watchWorkflow(workflowId: string, { signal }: CallOptions = {}) {
    let seen: string | undefined;
    let failures = 0;
    let held = false;
    for (;;) {
      let workflow: Workflow;
      try {
        workflow = await getWorkflow(
          workflowId,
          held ? { wait: HELD_READ_SECONDS, until: 'change', signal } : { signal },
        );
        failures = 0;
      } catch (error) {
        if (signal?.aborted || !isTransient(error) || failures >= RETRY_BACKOFF_MS.length) throw error;
        await sleep(RETRY_BACKOFF_MS[failures++]!, signal);
        continue;
      }
      held = true;
      // Compared whole, so anything the orchestrator adds to a workflow counts as progress.
      const snapshot = JSON.stringify(workflow);
      if (snapshot !== seen) {
        seen = snapshot;
        yield workflow;
      }
      if (isTerminal(workflow)) return;
    }
  }

  return {
    submitWorkflow: (template, { wait, signal } = {}) =>
      http<Workflow>('POST', WORKFLOWS, { body: template, query: { wait }, signal }),

    estimateWorkflow: (template, { signal } = {}) =>
      http<Workflow>('POST', WORKFLOWS, { body: template, query: { whatif: true }, signal }),

    getWorkflow,

    watchWorkflow,

    async waitForWorkflow(workflowId, opts = {}) {
      let last: Workflow | undefined;
      for await (const workflow of watchWorkflow(workflowId, opts)) last = workflow;
      return last!;
    },

    cancelWorkflow: async (workflowId, { signal } = {}) => {
      await http('PUT', `${WORKFLOWS}/${encodeURIComponent(workflowId)}`, {
        body: { status: 'canceled' },
        signal,
      });
    },

    queryWorkflows: (query = {}, { signal } = {}) =>
      http<WorkflowPage>('GET', WORKFLOWS, { query: { ...query }, signal }),
  };
}

/** A blip is worth waiting out; a refusal is an answer. */
function isTransient(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500 || error.status === 429;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
