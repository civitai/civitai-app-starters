import { useCallback } from 'react';

import { armConsentRefusalLatch } from '../internal/consentRefusalLatch.js';
import { getTransport } from '../internal/singleton.js';

/**
 * Lazy consent. Asks the host to open civitai.com's consent UI when a
 * LOGGED-IN viewer clicks an action whose consent-gated scope the block token
 * is missing — e.g. the block's Generate button needs `ai:write:budgeted` /
 * `buzz:read:self` but the viewer hasn't granted them yet (so the mint withheld
 * them and `useBlockToken().scopes` doesn't include them). The host validates
 * the message like every inbound one (origin + `event.source` pinned, only
 * honored after BLOCK_READY) and opens its consent UI.
 *
 * `scopes` is an advisory hint of which scopes the action needs. It is optional
 * in the signature, and for the GRANT path it genuinely is: the host
 * independently grants the missing set it computed at mint, so a bare
 * `requestConsent()` still opens the consent dialog.
 *
 * 🔴 BUT OMITTING IT DISABLES THE REFUSAL PATH ENTIRELY — pass `scopes`, AND
 * PUT A REAL SCOPE NAME IN IT. The host's `CONSENT_UNAVAILABLE` push (see
 * `useConsentUnavailable`) is computed FROM this hint, and the bar is higher
 * than "an array is present": `resolveUngrantableConsentNotice` returns "no
 * notice" unless the hint is an array containing AT LEAST ONE NON-EMPTY STRING.
 * `undefined`, a non-array, `[]`, `['']` and `[1, 2]` all produce silence —
 * measured on this package's implementation, and the real host has the identical
 * `requested.length === 0` guard, so `requestConsent({ scopes: [] })` obeys the
 * instruction above and STILL gets nothing back. That is deliberate — without a
 * named scope proven un-grantable there is no way to distinguish "can NEVER be
 * granted here" from "the viewer hasn't confirmed the dialog yet", and guessing
 * is what produced the contradictory two-message screen this path exists to
 * remove. The consequence for a block author: call `requestConsent()` bare (or
 * with an empty hint) on an un-grantable surface and you get SILENCE — no grant,
 * no refusal, no error — which reads as a broken message rather than a thin
 * argument.
 *
 * Fire-and-forget: the host doesn't reply. On grant the host re-mints the block
 * token and pushes a TOKEN_REFRESH carrying the now-granted scopes — observe
 * `useBlockToken().scopes` and retry the action once the scope appears. Mirrors
 * {@link useRequestSignIn} (the anonymous-conversion analog).
 *
 * @example
 * const { requestConsent } = useRequestConsent();
 * // viewer is logged in but the token lacks the spend scopes:
 * requestConsent({ scopes: ['ai:write:budgeted', 'buzz:read:self'] });
 */
export function useRequestConsent(): {
  requestConsent: (payload?: { scopes?: string[] }) => void;
} {
  const requestConsent = useCallback((payload?: { scopes?: string[] }) => {
    const transport = getTransport();
    // Arm the refusal buffer BEFORE the request goes out. A `CONSENT_UNAVAILABLE`
    // can only ever follow a `REQUEST_CONSENT`, and the transport drops an
    // unsolicited push that has no listener at the instant it arrives — so this
    // ordering is what lets a refusal survive until a `useConsentUnavailable()`
    // mounts, instead of requiring one to already be mounted. Idempotent.
    armConsentRefusalLatch(transport);
    transport.sendMessage({
      type: 'REQUEST_CONSENT',
      ...(payload ? { payload } : {}),
    });
  }, []);
  return { requestConsent };
}
