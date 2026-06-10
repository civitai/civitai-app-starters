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
 * `scopes` is an optional advisory hint of which scopes the action needs; the
 * host independently grants the missing set it computed at mint, so the block
 * can omit it.
 *
 * Fire-and-forget: the host doesn't reply. On grant the host re-mints the block
 * token and pushes a TOKEN_REFRESH carrying the now-granted scopes — observe
 * `useBlockToken().scopes` and retry the action once the scope appears. Mirrors
 * {@link useRequestSignIn} (the anonymous-conversion analog).
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
