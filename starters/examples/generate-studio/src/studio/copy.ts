import { WorkflowEstimateError, WorkflowSubmitError } from '@civitai/blocks-react';
import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

/**
 * Viewer-facing copy THIS APP owns, chosen by error CODE — never by prose.
 *
 * 🔴 `snapshot.error` and `err.message` are never rendered. The first is
 * server-authored and unsanitised; the second is developer-facing and not a
 * contract. `logServerReason` keeps them reachable in the console instead.
 * Same rules as the `buzz-workflow` and `buzz-purchase` examples.
 */

/** Why there is no price. Branches on `WorkflowEstimateError.code` only. */
export function estimateFailureMessage(err: unknown): string {
  if (err instanceof WorkflowEstimateError) {
    return err.code === 'failed'
      ? "This setup can't be priced. Check the model, LoRAs and source image, then try again."
      : 'No price is available right now.';
  }
  return "Couldn't reach Civitai to price this generation.";
}

/**
 * What a REJECTED submit means for money (a priced refusal RESOLVES instead, and
 * is explained from the numbers — see `blocker.ts`).
 *
 * - `'workflow-failed'`: a workflow probably exists and Buzz MAY be committed.
 *   Never invite a retry (a fresh key = a second reservation); watch the id
 *   instead — unless it is `'whatif'`, the server's non-workflow sentinel.
 * - `'exception'`: the host had no workflow to report. In production a wallet
 *   the orchestrator could not debit lands here, so the caller re-reads the
 *   wallet before choosing between "top up" and this copy.
 * - anything else is transport-level (most likely the timeout): it may well have
 *   been queued and charged, so the most cautious copy.
 */
export function submitRejection(err: unknown): { message: string; watchId?: string; maybeWallet: boolean } {
  if (err instanceof WorkflowSubmitError) {
    if (err.code === 'workflow-failed') {
      const id = err.snapshot.workflowId;
      return {
        message: 'Submitted, but it did not complete. Check your history before retrying.',
        ...(id && id !== 'whatif' ? { watchId: id } : {}),
        maybeWallet: false,
      };
    }
    return { message: 'Could not start the generation. Please try again.', maybeWallet: true };
  }
  return {
    message: 'We lost contact before the generation was confirmed. Check your history before trying again.',
    maybeWallet: false,
  };
}

/**
 * A `failed` seen while WATCHING. Budget and cap rules run before a workflow is
 * forwarded, so this is the generation itself failing — not a spending limit —
 * and the workflow may well have been charged. Don't reuse the submit copy.
 */
export const WATCH_FAILED_MESSAGE = 'The generation failed. Your history shows whether it was charged.';

export function logServerReason(where: string, snap: BlockWorkflowSnapshot | null | undefined, thrown?: unknown) {
  if (snap?.error) console.warn(`[generate-studio] ${where} — server reason:`, snap.error);
  if (thrown !== undefined) console.warn(`[generate-studio] ${where} threw:`, thrown);
}
