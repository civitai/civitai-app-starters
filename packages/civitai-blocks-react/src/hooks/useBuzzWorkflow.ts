import { useCallback, useState } from 'react';

import type { BlockWorkflowSnapshot, WorkflowBody, WorkflowStatus } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * Snapshot statuses that mean "no further polling is needed."
 * Used by both `submit` (a host can return an instant-fail / cached result)
 * and `poll` so the hook can't get stuck in 'polling' after a terminal reply.
 */
const TERMINAL_STATUSES: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/**
 * The workflow requests (estimate / submit / poll) are orchestrator-bound:
 * the host forwards them to the generation orchestrator and only replies
 * once it answers. `submit` is the slowest — server-side it does a whatif
 * cost-preflight AND the real submit (two orchestrator round-trips) plus a
 * prompt audit before responding, which legitimately exceeds the
 * transport's 30s `DEFAULT_REQUEST_TIMEOUT_MS` (tuned for fast bridge
 * messages) when the orchestrator queue is busy. Give these calls a
 * generous ceiling so a busy-but-healthy orchestrator doesn't surface as
 * a spurious `request "SUBMIT_WORKFLOW" timed out` rejection.
 */
const WORKFLOW_REQUEST_TIMEOUT_MS = 120_000;

interface UseBuzzWorkflowReturn {
  estimate: (body: WorkflowBody) => Promise<BlockWorkflowSnapshot>;
  submit: (body: WorkflowBody) => Promise<BlockWorkflowSnapshot>;
  poll: (workflowId: string) => Promise<BlockWorkflowSnapshot>;
  status: WorkflowStatus;
  result: BlockWorkflowSnapshot | null;
  error: Error | null;
}

/**
 * Orchestrates the estimate → confirm → submit → poll dance through the
 * host-mediated `postMessage` path.
 *
 * The host enforces budget rules (`cost_estimate <= token.buzzBudget`)
 * before forwarding to the orchestrator; submit() will reject if the host
 * refuses. Block apps should call `useBuzzPurchase().openPurchaseModal()`
 * when that happens.
 */
export function useBuzzWorkflow(): UseBuzzWorkflowReturn {
  const [status, setStatus] = useState<WorkflowStatus>('idle');
  const [result, setResult] = useState<BlockWorkflowSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const estimate = useCallback(async (body: WorkflowBody) => {
    setError(null);
    setStatus('estimating');
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'ESTIMATE_WORKFLOW', payload: { body } },
        'ESTIMATE_RESULT',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      setResult(snapshot);
      setStatus('confirming');
      return snapshot;
    } catch (err) {
      setError(err as Error);
      setStatus('error');
      throw err;
    }
  }, []);

  const submit = useCallback(async (body: WorkflowBody) => {
    setError(null);
    setStatus('submitting');
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'SUBMIT_WORKFLOW', payload: { body } },
        'WORKFLOW_SUBMITTED',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      setResult(snapshot);
      setStatus(TERMINAL_STATUSES.has(snapshot.status) ? 'done' : 'polling');
      return snapshot;
    } catch (err) {
      setError(err as Error);
      setStatus('error');
      throw err;
    }
  }, []);

  const poll = useCallback(async (workflowId: string) => {
    setStatus('polling');
    try {
      const { snapshot } = await sendTypedRequest(
        getTransport(),
        { type: 'POLL_WORKFLOW', payload: { workflowId } },
        'WORKFLOW_STATUS',
        { timeoutMs: WORKFLOW_REQUEST_TIMEOUT_MS },
      );
      setResult(snapshot);
      if (TERMINAL_STATUSES.has(snapshot.status)) {
        setStatus('done');
      }
      return snapshot;
    } catch (err) {
      setError(err as Error);
      setStatus('error');
      throw err;
    }
  }, []);

  return { estimate, submit, poll, status, result, error };
}
