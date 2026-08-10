import { useCallback, useEffect, useState } from 'react';

import type { ConsentUnavailablePayload } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { subscribeTyped } from '../internal/transport.js';

export type { ConsentUnavailablePayload };

/** What {@link useConsentUnavailable} returns. */
export interface UseConsentUnavailable {
  /**
   * The most recent `CONSENT_UNAVAILABLE` push, or `null` if the host has not
   * refused (the normal case — nothing to render differently).
   *
   * 🔴 `refusal.scopes` CAN BE EMPTY and that is still a refusal. The host
   * decides to refuse on its own UNFILTERED un-grantable set, then filters the
   * names it puts on the wire down to the public block-scope vocabulary — so a
   * request naming nothing the platform recognises refuses with `scopes: []`.
   * Branch on `refusal !== null`; use `refusal.scopes` only to word the copy.
   */
  refusal: ConsentUnavailablePayload | null;
  /**
   * Clear the stored refusal.
   *
   * A refusal is scoped to the scopes that were asked for, not to the block, so
   * it must not latch forever: a block that is refused `ai:write:budgeted` may
   * still legitimately request something else later, and a long-lived block
   * whose host re-inits (sign-in, a new token) can find itself grantable again.
   * Call this when you move on from the refused action.
   */
  reset: () => void;
}

/**
 * Subscribe to the host's `CONSENT_UNAVAILABLE` push — the signal that a
 * `REQUEST_CONSENT` this block sent can **never** be granted in this
 * environment, because the scope was clamped or withheld at mint. Distinct from
 * "the viewer hasn't confirmed the dialog yet", which produces no message at
 * all.
 *
 * This is the whole point of the message: without it a block keeps telling the
 * user *"Confirm in the Civitai dialog. If you dismissed it, click Generate
 * again"* while the host says the permission is unavailable — two contradictory
 * messages on one screen, and the misleading one is the block's.
 *
 * 🔴 **PRECONDITION — pass `scopes` to `requestConsent()`.** The refusal is
 * computed from the request's `scopes` hint. Both dev hosts and the real host
 * (`resolveUngrantableConsentNotice`) return "no notice" when the hint is
 * absent or not an array, because without a named scope proven un-grantable
 * there is no way to distinguish "never" from "not confirmed yet" and guessing
 * is what produced the contradictory screen. So a block that calls
 * `requestConsent()` bare will NEVER see a refusal here — in dev or in
 * production — and this hook will sit at `null` forever. Call
 * `requestConsent({ scopes: [...] })`.
 *
 * Uncorrelated by design: `REQUEST_CONSENT` carries no `requestId`, so this is
 * a fire-and-forget push, not a reply. Nothing here awaits anything — against a
 * host that never sends the message the hook simply stays `null`, which is
 * today's behaviour.
 *
 * The subscription goes through the transport, so the handler runs only after
 * the message has cleared the origin allowlist AND the payload validator; the
 * hook never adds its own `window` listener behind that boundary.
 *
 * @example
 * const { requestConsent } = useRequestConsent();
 * const { refusal } = useConsentUnavailable();
 *
 * if (refusal) return <p>Generating isn't available on this page.</p>;
 * return <button onClick={() => requestConsent({ scopes: ['ai:write:budgeted'] })}>Generate</button>;
 */
export function useConsentUnavailable(): UseConsentUnavailable {
  const [refusal, setRefusal] = useState<ConsentUnavailablePayload | null>(null);

  useEffect(() => {
    // `subscribeTyped` (not the raw `onMessage`) is what makes `payload` a
    // `ConsentUnavailablePayload` here instead of `unknown` + a cast at the call
    // site — the cast is unchecked, so a payload shape change would compile
    // straight through it in every consuming block.
    return subscribeTyped(getTransport(), 'CONSENT_UNAVAILABLE', (payload) => {
      // Store the payload UNCONDITIONALLY. No `payload.scopes.length` gate: an
      // empty `scopes` is a legitimate refusal (see `UseConsentUnavailable`),
      // and gating on it would drop the message this hook exists to deliver.
      setRefusal(payload);
    });
  }, []);

  const reset = useCallback(() => setRefusal(null), []);

  return { refusal, reset };
}
