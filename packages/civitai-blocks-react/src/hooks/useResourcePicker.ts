import { useCallback } from 'react';

import type { BlockResourceInfo, BlockResourcePickerType } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';
import { PICKER_REQUEST_TIMEOUT_MS } from './useCheckpointPicker.js';

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
 * const { open } = useResourcePicker();
 * const picked = await open({ resourceType: 'LORA', baseModelGroup: 'SDXL' });
 * if (!picked) return;                 // user dismissed
 * // feed picked.versionId into body.additionalResources and submit
 */
export function useResourcePicker(): {
  open: (opts: {
    /** Which resource type to pick. v1: `'Checkpoint' | 'LORA'` only — the
     * host rejects any other type (the modal never opens). */
    resourceType: BlockResourcePickerType;
    /**
     * Optional base-model family hint — an ecosystem key (e.g. 'Flux1', 'SDXL')
     * OR a baseModel name (e.g. 'Flux.1 D'); the host collapses it to the
     * ecosystem family. Use the chosen checkpoint's `baseModel` to constrain a
     * LoRA pick to the same family. Omit for an unconstrained pick of the type.
     */
    baseModelGroup?: string;
  }) => Promise<BlockResourceInfo | null>;
} {
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
        { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
      );
      // Normalize the "dismissed" case to an explicit null so callers can
      // `if (!picked) return;` without an `undefined` ambiguity.
      return selected ?? null;
    },
    [],
  );

  return { open };
}
