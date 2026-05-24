import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';

/**
 * Fire-and-forget analytics tracking. The host forwards events to its
 * analytics pipeline (ClickHouse in production); the block doesn't see
 * acknowledgements and shouldn't block on them.
 */
export function useBlockAnalytics(): {
  track: (eventName: string, properties?: Record<string, unknown>) => void;
} {
  const track = useCallback((eventName: string, properties?: Record<string, unknown>) => {
    getTransport().sendMessage({ type: 'TRACK_EVENT', payload: { eventName, properties } });
  }, []);
  return { track };
}
