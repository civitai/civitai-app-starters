import { useCallback } from 'react';

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
 * 🔴 BUT OMITTING IT DISABLES THE REFUSAL PATH ENTIRELY — pass `scopes`. The
 * host's `CONSENT_UNAVAILABLE` push (see `useConsentUnavailable`) is computed
 * FROM this hint: `resolveUngrantableConsentNotice` returns "no notice" the
 * moment the hint is absent or not an array, in the real host and in both dev
 * hosts alike. That is deliberate — without a named scope proven un-grantable
 * there is no way to distinguish "can NEVER be granted here" from "the viewer
 * hasn't confirmed the dialog yet", and guessing is what produced the
 * contradictory two-message screen this whole path exists to remove. The
 * consequence for a block author: call `requestConsent()` bare on an
 * un-grantable surface and you get SILENCE — no grant, no refusal, no error —
 * which reads as a broken message rather than a missing argument.
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
    getTransport().sendMessage({
      type: 'REQUEST_CONSENT',
      ...(payload ? { payload } : {}),
    });
  }, []);
  return { requestConsent };
}
