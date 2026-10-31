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

/** The per-generation limit message. The installer sets that limit; Buzz can't raise it. */
export function overLimitMessage(price: number, budget: number): string {
  return (
    `This generation costs ${price} Buzz, over this app's ${budget}-Buzz limit per generation. ` +
    "Buying Buzz can't change that limit; the app's installer sets it."
  );
}

/**
 * What to tell the viewer after `submit` RESOLVED with `status: 'failed'`. Never a top-up.
 *
 * `price` is the quote; `budget` is `token.buzzBudget` read when the reply
 * arrives, NOT when Generate was pressed (the token can be re-minted in
 * between). A placeholder refusal priced over it is the per-generation limit.
 * Any other placeholder refusal is a cap or limit the viewer can't see the size
 * of: "try again later". An unknown budget (the token lost the spend scope)
 * falls into that second case.
 */
export function resolvedFailureMessage(
  snap: { workflowId: string },
  price: number,
  budget: number | undefined,
): string {
  if (snap.workflowId !== 'failed') {
    return 'This generation failed and may have been charged. Check your generation history before trying again.';
  }
  if (budget !== undefined && price > budget) return overLimitMessage(price, budget);
  return "This generation couldn't run right now, and nothing was charged. Please try again later.";
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
