import { useCallback } from 'react';

import type { BlockResourceInfo, BlockResourcePickerType } from '@civitai/app-sdk/blocks';

import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/** What {@link useResourcePicker} returns. */
export interface UseResourcePicker {
  open: (opts: {
    /** Which resource type to pick. v1: `'Checkpoint' | 'LORA'` only — the
     * host rejects any other type (the modal never opens). */
    resourceType: BlockResourcePickerType;
    /**
     * 🔴 OMIT THIS BY DEFAULT. It is an optional base-model family FILTER, not a
     * label: whatever you pass, the host HIDES every resource outside that
     * ecosystem, so the viewer's own perfectly valid LoRAs simply do not appear
     * and the picker looks empty or broken. Omitting it is an unconstrained pick
     * of the type — every resource the viewer can reach.
     *
     * Pass it ONLY when the block already holds a chosen checkpoint the pick has
     * to match, and then DERIVE it from that checkpoint — `checkpoint.baseModel`,
     * or `useBlockContext().context.checkpoint?.baseModel`. Never a hardcoded
     * ecosystem string: a literal pins every viewer of the app to whichever
     * family the author happened to be testing with.
     *
     * Accepts an ecosystem key (e.g. 'Flux1', 'SDXL') OR a baseModel name (e.g.
     * 'Flux.1 D'); the host collapses either to the ecosystem family.
     */
    baseModelGroup?: string;
  }) => Promise<BlockResourceInfo | null>;
}

/**
 * Drives the platform-side resource picker for PAGE App Blocks (Design 1 —
 * host-chrome). Generalizes {@link useCheckpointPicker} from Checkpoint-only to
 * a typed allowlist (v1: `'Checkpoint' | 'LORA'`), so a page block can let the
 * USER pick a checkpoint + LoRAs instead of the author hard-coding version IDs.
 *
 * `open` asks the host to open its OWN native resource modal filtered to the
 * requested type (+ optional base-model family). The viewer searches in HOST
 * chrome — the block never sees the catalog, a list, or any resource it didn't
 * pick. Resolves with the chosen {@link BlockResourceInfo}, or `null` when the
 * user dismissed without picking.
 *
 * DISCOVERY ONLY: the returned `versionId` is a hint, never an entitlement.
 * Feed it into `body.modelVersionId` (Checkpoint) or
 * `body.additionalResources` (LoRA) and submit — the host re-validates every id
 * server-side at estimate/submit (the page gate + orchestrator belt). A block
 * can POST any id regardless of what the picker showed; the spend path is the
 * enforcement boundary, not the picker.
 *
 * Host-mediated, same trust model as `useCheckpointPicker` / `useBuzzWorkflow`:
 * the block never touches the picker UI directly.
 *
 * @example
 * // DEFAULT — no ecosystem. The viewer sees every LoRA they can reach.
 * const { open } = useResourcePicker();
 * const picked = await open({ resourceType: 'LORA' });
 * if (!picked) return;                 // user dismissed
 * // feed picked.versionId into body.additionalResources and submit
 *
 * @example
 * // ONLY when the block already holds a chosen checkpoint the LoRA must match:
 * // derive the family from THAT checkpoint. A hardcoded ecosystem here hides
 * // every resource outside it from the viewer.
 * const picked = await open({ resourceType: 'LORA', baseModelGroup: checkpoint.baseModel });
 */
export function useResourcePicker(): UseResourcePicker {
  const open = useCallback(
    async (opts: { resourceType: BlockResourcePickerType; baseModelGroup?: string }) => {
      const { selected } = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_RESOURCE_PICKER',
          payload: {
            resourceType: opts.resourceType,
            ...(opts.baseModelGroup != null ? { baseModelGroup: opts.baseModelGroup } : {}),
          },
        },
        'RESOURCE_PICKER_RESULT',
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      // Normalize the "dismissed" case to an explicit null so callers can
      // `if (!picked) return;` without an `undefined` ambiguity.
      return selected ?? null;
    },
    [],
  );

  return { open };
}
