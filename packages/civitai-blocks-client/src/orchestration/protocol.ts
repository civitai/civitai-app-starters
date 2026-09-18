import type {
  Workflow,
  WorkflowTemplate,
} from '@civitai/orchestration-client/dist/generated/types.gen.js';

/**
 * The bridge's one addition to the orchestrator's own contract: a hard Buzz
 * ceiling. Spend is the binding control on this path, and the host caps it
 * again at the block token's budget.
 */
export interface SpendLimit {
  maxBuzz: number;
}

export type OrchestrationRequests = {
  ORCHESTRATION_ESTIMATE_WORKFLOW: {
    params: SpendLimit & { workflow: WorkflowTemplate };
    result: Workflow;
  };
  ORCHESTRATION_SUBMIT_WORKFLOW: {
    params: SpendLimit & { workflow: WorkflowTemplate };
    result: Workflow;
  };
  ORCHESTRATION_GET_WORKFLOW: {
    /**
     * `wait` asks the host to hold the read until something changes. How long
     * it holds is its own business — it knows what it is waiting on.
     */
    params: { workflowId: string; wait?: boolean };
    result: Workflow;
  };
  ORCHESTRATION_CANCEL_WORKFLOW: { params: { workflowId: string }; result: Workflow };
};
