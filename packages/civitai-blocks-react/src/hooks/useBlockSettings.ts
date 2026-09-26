import type { BlockSettings } from '@civitai/app-sdk/blocks';

import { useTransportSnapshot } from './useBlockContext.js';

/**
 * What {@link useBlockSettings} returns. An alias — see
 * `./returnTypeLedger.js` for why every hook on the entry has one of these.
 */
export type UseBlockSettings = BlockSettings;

/**
 * Shorthand for `useBlockContext().settings`. Returns the publisher- and
 * user-controlled settings the host forwarded at init. Read-only from the
 * iframe — there is no general "set settings" bridge message. Writing them is
 * platform-side, in Civitai's own app settings panel. The one setting a block
 * can write itself is the viewer's checkpoint, via the `SET_USER_CHECKPOINT`
 * message (see `useCheckpointPicker`).
 *
 * @example
 * const { publisherSettings, userSettings } = useBlockSettings();
 */
export function useBlockSettings(): UseBlockSettings {
  return useTransportSnapshot().settings;
}
