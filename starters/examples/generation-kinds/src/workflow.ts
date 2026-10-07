import { WorkflowEstimateError, WorkflowSubmitError } from '@civitai/blocks-react';
import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

/**
 * The money-path rules every panel shares, in ONE place so the two panels
 * cannot disagree about them. They are the `buzz-workflow` example's rules,
 * unchanged: what differs between body kinds is the BODY, never how a refusal
 * or a failure is classified.
 *
 * 🔴 NONE OF THESE RENDER A SERVER STRING. `snapshot.error` is server-authored
 * and unsanitised; it is logged for the developer by {@link logServerReason}
 * and the viewer sees only copy this app owns.
 */

/** `succeeded | failed | canceled | expired` — the snapshot will not change again. */
export const TERMINAL_STATUSES: ReadonlySet<BlockWorkflowSnapshot['status']> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

/** Gap between polls. The hook does NOT auto-poll; each panel runs its own loop. */
export const POLL_INTERVAL_MS = 2500;

/**
 * Viewer copy for an estimate that produced no price. Branch on the error's
 * `code`, never on its prose:
 *  - `'failed'`  — the server refused this body (its reason is logged);
 *  - `'no-cost'` — the reply succeeded but carried no price;
 *  - anything else — the request itself did not complete.
 */
export function estimateFailureMessage(err: unknown): string {
  if (err instanceof WorkflowEstimateError) {
    return err.code === 'failed'
      ? "This can't be priced as configured. Try different input."
      : 'No price is available right now.';
  }
  return "Couldn't reach Civitai to price this.";
}

/** Log the server's own words for the developer. Never rendered. */
export function logServerReason(where: string, snap: BlockWorkflowSnapshot | null, thrown?: unknown): void {
  if (snap?.error) console.warn(`[generation-kinds] ${where} — server reason:`, snap.error);
  if (thrown) console.warn(`[generation-kinds] ${where} threw:`, thrown);
}

/**
 * Viewer copy for a `failed` SUBMIT reply (submit RESOLVED, it did not reject).
 * A failed submit that carries a `cost` is the host DECLINING to spend — the
 * per-call budget, a daily or per-app cap, a velocity limit, a transient deny.
 * Buying Buzz fixes none of those, so only the affordability case gets its own
 * string.
 */
export function submitFailureMessage(snap: BlockWorkflowSnapshot): string {
  if (typeof snap.cost?.total === 'number') {
    return /insufficient|not enough|budget/i.test(snap.error ?? '')
      ? 'Not enough Buzz (or over this app’s per-run budget) for this run.'
      : 'This run was not started. Please try again later.';
  }
  return 'This run could not be started. Please try again.';
}

/**
 * What to show — and whether there is anything to poll — when `submit()`
 * REJECTS. The arms differ on MONEY:
 *  - `'workflow-failed'` — a workflow probably exists and Buzz MAY already be
 *    committed: poll its id (unless it is the `'whatif'` sentinel), never
 *    invite a blind retry, which would reserve a second time;
 *  - `'exception'` — the host had no workflow to report; a retry is sensible;
 *  - anything else is transport-level (a timeout) and may well have been
 *    queued and charged: the most cautious copy.
 */
export function submitRejectionOutcome(err: unknown): { viewerMessage: string; pollWorkflowId?: string } {
  if (err instanceof WorkflowSubmitError) {
    if (err.code === 'workflow-failed') {
      const id = err.snapshot.workflowId;
      return {
        viewerMessage: 'Submitted, but it did not complete. Check your generation history before retrying.',
        ...(id && id !== 'whatif' ? { pollWorkflowId: id } : {}),
      };
    }
    return { viewerMessage: 'Could not start. Please try again.' };
  }
  return {
    viewerMessage: 'We lost contact before the run was confirmed. Check your generation history before trying again.',
  };
}

/**
 * Viewer copy for a failure observed while POLLING. Budget and cap refusals
 * happen before a workflow exists, so a `failed` here is the run itself
 * failing — do not reuse the submit discriminator (a polled snapshot carries a
 * `cost` too, and that would mislabel a crash as a spending limit).
 */
export function pollFailureMessage(): string {
  return 'The run failed. Please try again.';
}

/**
 * Drive one workflow to a terminal snapshot with `poll()`, the way
 * `buzz-workflow` does: caller-owned loop, a transport blip is retried on the
 * next tick. Returns a stop function (call it on unmount).
 */
export function pollUntilTerminal(
  poll: (workflowId: string) => Promise<BlockWorkflowSnapshot>,
  workflowId: string,
  onSnapshot: (snap: BlockWorkflowSnapshot) => void,
): () => void {
  let stopped = false;
  let timer: number | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      const snap = await poll(workflowId);
      if (stopped) return;
      onSnapshot(snap);
      if (TERMINAL_STATUSES.has(snap.status)) return;
    } catch {
      /* transient — the next tick retries */
    }
    if (!stopped) timer = window.setTimeout(tick, POLL_INTERVAL_MS);
  };
  timer = window.setTimeout(tick, POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
