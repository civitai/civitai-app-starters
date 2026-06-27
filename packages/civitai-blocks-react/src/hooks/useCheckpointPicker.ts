import { useCallback } from 'react';

import type { BlockCheckpointInfo } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * A resource picker is HUMAN-interactive — the user browses the catalog and may
 * take a while to choose. The default request timeout (~30s) is for fast
 * protocol round-trips and would reject a slow browse mid-pick. Use a generous
 * bound instead; the host still resolves earlier on pick/dismiss/close.
 */
export const PICKER_REQUEST_TIMEOUT_MS = 10 * 60_000;

/**
 * Drives the platform-side Checkpoint picker and the persist-override flow.
 *
 * `open` opens the host's Resource picker filtered to Checkpoints in the
 * given ecosystem; resolves with `{ selected }` (undefined when the user
 * dismissed without picking).
 *
 * `persist` writes the chosen versionId into `block_user_settings` via the
 * host. Pass `null` to clear the override and fall back to the publisher
 * default at next mount. Throws on host-side validation failure (e.g.
 * "wrong-ecosystem") — surface the message to the user; don't retry blindly.
 *
 * Both flows are host-mediated: the block never touches the picker UI or
 * the user-settings table directly. Same trust model as useBuzzPurchase /
 * useBuzzWorkflow.
 */
export function useCheckpointPicker(): {
  open: (opts: {
    /**
     * Ecosystem key (e.g. 'Flux1', 'SDXL'). Get it from
     * `useBlockContext().context.checkpoint?.baseModel` — but for the
     * picker filter the host will collapse to the ecosystem family, so
     * any baseModel in the family works as a hint.
     */
    baseModelGroup: string;
    /** Currently-selected versionId so the picker can pre-highlight it. */
    currentVersionId?: number;
  }) => Promise<{ selected?: BlockCheckpointInfo }>;
  persist: (versionId: number | null) => Promise<void>;
} {
  const open = useCallback(
    async (opts: { baseModelGroup: string; currentVersionId?: number }) => {
      const { selected } = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_CHECKPOINT_PICKER',
          payload: {
            baseModelGroup: opts.baseModelGroup,
            ...(opts.currentVersionId != null
              ? { currentVersionId: opts.currentVersionId }
              : {}),
          },
        },
        'CHECKPOINT_PICKER_RESULT',
        { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
      );
      return { selected };
    },
    [],
  );

  const persist = useCallback(async (versionId: number | null) => {
    const { ok, error } = await sendTypedRequest(
      getTransport(),
      { type: 'SET_USER_CHECKPOINT', payload: { versionId } },
      'USER_CHECKPOINT_SET',
    );
    if (!ok) {
      throw new Error(error ?? 'failed to persist checkpoint');
    }
  }, []);

  return { open, persist };
}
