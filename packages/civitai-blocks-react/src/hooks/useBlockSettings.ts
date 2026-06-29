import type { BlockSettings } from '@civitai/app-sdk/blocks';

import { useTransportSnapshot } from './useBlockContext.js';

/**
 * Shorthand for `useBlockContext().settings`. Returns the publisher- and
 * user-controlled settings the host forwarded at init. Read-only from the
 * iframe — settings are *written* on the platform `/apps/installed` page,
 * not via a bridge message.
 *
 * @example
 * const { publisherSettings, userSettings } = useBlockSettings();
 */
export function useBlockSettings(): BlockSettings {
  return useTransportSnapshot().settings;
}
