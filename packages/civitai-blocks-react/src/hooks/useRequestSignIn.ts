import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';

/**
 * Anonymous conversion. Asks the host to start civitai.com's login flow when a
 * logged-out viewer (`useBlockContext().viewer === null`) clicks an action that
 * needs auth/money — e.g. the block's Generate button. The host validates the
 * message like every inbound one (origin + `event.source` pinned, only honored
 * after BLOCK_READY) and opens its login UI.
 *
 * `returnUrl` is an optional same-origin in-app path to return to after sign-in;
 * the host sanitises it (rejecting absolute / protocol-relative values) and
 * defaults to the current page when omitted.
 *
 * Fire-and-forget: the host doesn't reply. After login the page reloads / the
 * block re-inits as an authenticated viewer.
 */
export function useRequestSignIn(): {
  requestSignIn: (payload?: { returnUrl?: string }) => void;
} {
  const requestSignIn = useCallback((payload?: { returnUrl?: string }) => {
    getTransport().sendMessage({
      type: 'REQUEST_SIGN_IN',
      ...(payload ? { payload } : {}),
    });
  }, []);
  return { requestSignIn };
}
