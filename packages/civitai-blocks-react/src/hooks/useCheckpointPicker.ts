import { useCallback } from 'react';

import type { BlockCheckpointInfo } from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { throwOnFailedReply } from '../internal/replyError.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/** What {@link useCheckpointPicker} returns. */
export interface UseCheckpointPicker {
  open: (opts: {
    /**
     * 🔴 DERIVE THIS, NEVER HARDCODE IT. It is a FILTER: the host hides every
     * checkpoint outside the family you pass, so a literal ecosystem pins every
     * viewer of the app to whichever family the author happened to be testing
     * with and makes their own valid checkpoints invisible.
     *
     * Read it from the checkpoint the block already holds —
     * `useBlockContext().context.checkpoint?.baseModel`, or the `baseModel` of
     * the pick you are replacing. Accepts an ecosystem key (e.g. 'Flux1',
     * 'SDXL') or any baseModel name in the family; the host collapses either to
     * the ecosystem family, so any baseModel in the family works as a hint.
     *
     * (Unlike {@link useResourcePicker}, this one is REQUIRED — a checkpoint
     * pick is always scoped to a family. Use `useResourcePicker` with
     * `resourceType: 'Checkpoint'` and no `baseModelGroup` for an unconstrained
     * checkpoint pick.)
     */
    baseModelGroup: string;
    /** Currently-selected versionId so the picker can pre-highlight it. */
    currentVersionId?: number;
  }) => Promise<{ selected?: BlockCheckpointInfo }>;
  persist: (versionId: number | null) => Promise<void>;
}

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
 *
 * @example
 * // Derive the family from the checkpoint the block already holds — never a
 * // hardcoded ecosystem, which hides every other family from the viewer.
 * const { open, persist } = useCheckpointPicker();
 * const { selected } = await open({
 *   baseModelGroup: checkpoint.baseModel,
 *   currentVersionId: checkpoint.versionId,
 * });
 * if (selected) await persist(selected.versionId);   // null clears the override
 */
export function useCheckpointPicker(): UseCheckpointPicker {
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
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      return { selected };
    },
    [],
  );

  const persist = useCallback(async (versionId: number | null) => {
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'SET_USER_CHECKPOINT', payload: { versionId } },
      'USER_CHECKPOINT_SET',
    );
    // This site tested `!ok` ALONE before PR #273, so the `error` clause is
    // new here, not merely retyped.
    throwOnFailedReply(reply, 'failed to persist checkpoint');
  }, []);

  return { open, persist };
}
