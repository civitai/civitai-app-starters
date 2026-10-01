import { useCallback } from 'react';

import type { BlockCheckpointInfo } from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { throwOnFailedReply } from '../internal/replyError.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/** What {@link useCheckpointPicker} returns. */
export interface UseCheckpointPicker {
  open: (opts?: {
    /**
     * 🔴 OMIT THIS BY DEFAULT. It is an ecosystem-family FILTER, not a label:
     * the host HIDES every checkpoint outside the family you pass. Passing the
     * family you are already in is therefore a trap — it makes the picker offer
     * only the ecosystem the user is trying to leave, and every other family
     * becomes unreachable for the life of the session.
     *
     * Omit it for an unconstrained pick: the host applies no base-model
     * narrowing and offers every checkpoint the viewer can generate with.
     *
     * Pass it ONLY when the block must stay inside a family it already holds —
     * a regenerate/variation flow pinned to one checkpoint's ecosystem, say —
     * and then DERIVE it from that checkpoint (`checkpoint.baseModel`, or
     * `useBlockContext().context.checkpoint?.baseModel`). Never a hardcoded
     * ecosystem string: a literal pins every viewer of the app to whichever
     * family the author happened to be testing with. Accepts an ecosystem key
     * (e.g. 'Flux1', 'SDXL') or any baseModel name in the family; the host
     * collapses either to the ecosystem family.
     *
     * An empty string is normalized to absent here and never reaches the wire,
     * and `''` is **not** an escape hatch — it does not even mean the same thing
     * on both hosts. On a **model slot** the host normalises whatever string you
     * send, so `''` resolves to the real ecosystem key `Other` and NARROWS to
     * that one family. On a **page** the host drops a zero-length value, so `''`
     * behaves exactly like omitting it. Neither is what you meant on at least one
     * surface: omit the key, or pass a family derived from a real checkpoint, and
     * never `''`.
     *
     * A WHITESPACE-ONLY string narrows on BOTH hosts — the page host's guard is
     * `length > 0`, which `'  '` passes — which is why this hook trims before
     * deciding.
     */
    baseModelGroup?: string;
    /** Currently-selected versionId so the picker can pre-highlight it. */
    currentVersionId?: number;
  }) => Promise<{ selected?: BlockCheckpointInfo }>;
  persist: (versionId: number | null) => Promise<void>;
}

/**
 * Drives the platform-side Checkpoint picker and the persist-override flow.
 *
 * `open` opens the host's Resource picker on Checkpoints and resolves with
 * `{ selected }` (undefined when the user dismissed without picking). By
 * default the pick is UNCONSTRAINED — every family the viewer can generate
 * with. Pass `baseModelGroup` only to pin it to one ecosystem.
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
 * // DEFAULT — no ecosystem. The viewer can reach every family.
 * const { open, persist } = useCheckpointPicker();
 * const { selected } = await open({ currentVersionId: checkpoint.versionId });
 * if (selected) await persist(selected.versionId);   // null clears the override
 *
 * @example
 * // ONLY when the block must stay inside a family it already holds: derive the
 * // filter from that checkpoint, never from a hardcoded ecosystem.
 * const { selected } = await open({ baseModelGroup: checkpoint.baseModel });
 */
export function useCheckpointPicker(): UseCheckpointPicker {
  const open = useCallback(
    async (opts?: { baseModelGroup?: string; currentVersionId?: number }) => {
      // Both keys are spread conditionally, and an empty or whitespace-only
      // family is normalized to absent.
      //
      // The distinction that matters is `''`/whitespace vs ABSENT — NOT
      // explicit-`undefined` vs absent. The model-slot host branches on
      // `typeof baseModelGroup === 'string'`, and `typeof undefined === 'string'`
      // is false, so a present-and-undefined key takes exactly the same "no
      // family" branch as an absent one on every host surface. A non-empty string
      // does not: it IS a string, so it survives that branch, and
      // `getBaseModelGroup` collapses an unrecognised value to the real ecosystem
      // key 'Other' — which NARROWS the picker to that one family instead of
      // widening it.
      //
      // 🔴 THE TWO SPELLINGS DIFFER BY HOST, so this normalization is doing two
      // different jobs:
      //   - `''` narrows on the MODEL SLOT (any string is normalised there) but
      //     is already equivalent to omission on the PAGE host, whose resolver
      //     drops a zero-length value before the lookup. Stripping it matters on
      //     one surface and is a no-op on the other.
      //   - a WHITESPACE-ONLY string narrows on BOTH: the page host's guard is
      //     `length > 0`, which `'  '` passes. That is what `.trim()` is for, and
      //     it is the half a test on `''` alone cannot see.
      // Absence is the only spelling that means "unconstrained" on both surfaces.
      const baseModelGroup = opts?.baseModelGroup?.trim();
      const { selected } = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_CHECKPOINT_PICKER',
          payload: {
            ...(baseModelGroup ? { baseModelGroup } : {}),
            ...(opts?.currentVersionId != null
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
