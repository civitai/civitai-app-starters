/**
 * Which Buzz this example may offer to sell, decided from the NUMBERS and from
 * which way `submit` settled — never from a refusal's wording. Kept free of
 * React and of runtime imports so the rules can be exercised on their own.
 *
 * 🔴 THE TWO WAYS A SUBMIT CAN FAIL, AND WHICH ONE A TOP-UP CAN FIX:
 *
 * - It RESOLVES with `status: 'failed'`. With the `'failed'` placeholder id the
 *   host refused before anything ran — a spend cap or limit (the per-generation
 *   budget, a daily or per-app cap, a velocity limit, a missing quote). Those
 *   checks run BEFORE the wallet is ever looked at, so buying Buzz raises none of
 *   them and a retry would hit the same cap: NEVER a top-up. With a REAL id a run
 *   was created and came back failed, and Buzz may already have been spent: not
 *   a top-up either, and never an automatic retry.
 * - It REJECTS with `WorkflowSubmitError` code `'exception'`. A viewer who is
 *   genuinely out of Buzz lands here (the orchestrator refuses to debit), but so
 *   do other failures, with nothing structural to tell them apart. So this is
 *   the ONLY branch that may offer a top-up, and only when the viewer's
 *   SPENDABLE Buzz is below the quoted price.
 *
 * The complete list of resolved replies is in `useBuzzWorkflow`'s `submit` docs.
 */

/** What to tell the viewer after `submit` RESOLVED with `status: 'failed'`. Never a top-up. */
export function resolvedFailureMessage(snap: { workflowId: string }): string {
  return snap.workflowId === 'failed'
    ? "This generation couldn't run right now, and nothing was charged. Please try again later."
    : 'This generation failed and may have been charged. Check your generation history before trying again.';
}

/**
 * How many Buzz to suggest buying, or `null` when a top-up would not help.
 * Only ever consulted after an `'exception'` rejection (or before submitting),
 * with `spendable` = blue plus this app's domain pool.
 */
export function walletShortfall(price: number, spendable: number | null): number | null {
  if (spendable === null || spendable >= price) return null;
  return price - spendable;
}
