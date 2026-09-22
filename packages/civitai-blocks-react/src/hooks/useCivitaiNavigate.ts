import { useCallback } from 'react';

import { getTransport } from '../transport/singleton.js';

/** What {@link useCivitaiNavigate} returns. */
export interface UseCivitaiNavigate {
  navigate: (path: string, target?: 'current' | 'new_tab') => void;
}

/**
 * Requests a navigation within civitai.com. The host mediates — `target:
 * "current"` navigates the parent frame; `"new_tab"` opens a new tab (which
 * requires `allow-popups-to-escape-sandbox` in the manifest sandbox).
 *
 * Fire-and-forget: the host doesn't reply with confirmation.
 *
 * @example
 * const { navigate } = useCivitaiNavigate();
 * navigate('/models/12345', 'new_tab');   // 'new_tab' needs allow-popups* in the manifest sandbox
 */
export function useCivitaiNavigate(): UseCivitaiNavigate {
  const navigate = useCallback((path: string, target: 'current' | 'new_tab' = 'current') => {
    getTransport().sendMessage({ type: 'NAVIGATE', payload: { path, target } });
  }, []);
  return { navigate };
}
