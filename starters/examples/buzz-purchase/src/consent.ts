/**
 * The "Allow generations" step, decided from state the block can observe.
 * Free of React and of runtime imports so every outcome can be exercised on its
 * own.
 *
 * 🔴 WHY THIS STEP COMES FIRST. Pricing needs the spend scope: the host's
 * estimate is refused without `ai:write:budgeted`, and `estimate()` never asks
 * for consent on its own (it runs without a click, so a dialog would open with
 * no gesture behind it). Without this step a viewer who has not consented sees
 * no price and a Generate button that never enables — `submit()`, which DOES
 * ask for consent, is never reached.
 *
 * `requestConsent()` is fire-and-forget (it posts a message and returns; it does
 * not throw), so its outcomes arrive by different routes, and every one of them
 * must leave a usable screen:
 *
 * - GRANTED: the host re-mints the token with the scope (`canSpend` flips);
 *   the step disappears and pricing starts.
 * - UNAVAILABLE: the host pushes `CONSENT_UNAVAILABLE` (`useConsentUnavailable`)
 *   — the scope can never be granted here. Say so and stop offering Allow,
 *   which could only fail again.
 * - DISMISSED or never answered: NOTHING arrives — a closed dialog has no
 *   message. Keep Allow enabled and say how to reopen it. No timer is needed,
 *   because nothing is waiting. The same "asked, scope not here yet" state also
 *   covers the moment between a grant and the re-minted token arriving, and a
 *   grant that added only the balance scope — so its wording has to be true in
 *   all three.
 *
 * Anonymous viewers get no consent-gated scope at all, so they are sent to
 * sign in instead of being shown an Allow button that cannot work.
 */
export type ConsentStep =
  | { kind: 'ready' }
  | { kind: 'sign-in' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'ask'; message: string | null };

export interface ConsentState {
  signedIn: boolean;
  /** The CURRENT token carries `ai:write:budgeted`. */
  canSpend: boolean;
  /** `useConsentUnavailable().refusal !== null`. */
  refused: boolean;
  /** Allow was pressed at least once. */
  asked: boolean;
}

export const UNAVAILABLE_MESSAGE =
  "Generating isn't available here: this page can't grant the permission it needs.";
export const ASKED_MESSAGE =
  'Waiting for permission. If the dialog closed without allowing, press Allow again.';

export function consentStep(s: ConsentState): ConsentStep {
  if (s.canSpend) return { kind: 'ready' };
  if (!s.signedIn) return { kind: 'sign-in' };
  if (s.refused) return { kind: 'unavailable', message: UNAVAILABLE_MESSAGE };
  return { kind: 'ask', message: s.asked ? ASKED_MESSAGE : null };
}
