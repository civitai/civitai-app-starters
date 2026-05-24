import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';

/**
 * Requests a navigation within civitai.com. The host mediates — `target:
 * "current"` navigates the parent frame; `"new_tab"` opens a new tab (which
 * requires `allow-popups-to-escape-sandbox` in the manifest sandbox).
 *
 * Fire-and-forget: the host doesn't reply with confirmation.
 */
export function useCivitaiNavigate(): {
  navigate: (path: string, target?: 'current' | 'new_tab') => void;
} {
  const navigate = useCallback((path: string, target: 'current' | 'new_tab' = 'current') => {
    getTransport().sendMessage({ type: 'NAVIGATE', payload: { path, target } });
  }, []);
  return { navigate };
}
