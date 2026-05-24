import type { BlockSettings } from '@civitai/app-sdk/blocks';

import { useTransportSnapshot } from './useBlockContext.js';

/**
 * Shorthand for `useBlockContext().settings`. Returns the publisher- and
 * user-controlled settings the host forwarded at init.
 */
export function useBlockSettings(): BlockSettings {
  return useTransportSnapshot().settings;
}
