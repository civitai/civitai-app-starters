import { useCallback } from 'react';

import { getTransport } from '../transport/singleton.js';

/** What {@link useCivitaiNavigate} returns. */
export interface UseCivitaiNavigate {
  navigate: (path: string, target?: 'current' | 'new_tab') => void;
}

/**
 * Requests a navigation within civitai.com: the hook sends a `NAVIGATE` message
 * to the host and returns. Fire-and-forget — the host doesn't reply with
 * confirmation, so the block never learns what the host did.
 *
 * `target` is a REQUEST, not a guarantee. How the host acts on `"current"` vs
 * `"new_tab"` is host-side behaviour, and the host is the authority on it; this
 * package sends the message and makes no promise about the outcome.
 *
 * 🔴 Nothing in your manifest enables `"new_tab"`. In particular, do NOT declare
 * `allow-popups-to-escape-sandbox`: the host intersects a manifest's
 * `iframe.sandbox` with a fixed allowlist that does not contain that token, so it
 * is dropped for every block at every trust tier and declaring it has no effect.
 * (Earlier versions of this doc said `"new_tab"` required it — that was wrong.)
 *
 * @example
 * const { navigate } = useCivitaiNavigate();
 * navigate('/models/12345');              // `target` defaults to 'current'
 * navigate('/models/12345', 'new_tab');   // requests a new tab; the host decides
 */
export function useCivitaiNavigate(): UseCivitaiNavigate {
  const navigate = useCallback((path: string, target: 'current' | 'new_tab' = 'current') => {
    getTransport().sendMessage({ type: 'NAVIGATE', payload: { path, target } });
  }, []);
  return { navigate };
}
