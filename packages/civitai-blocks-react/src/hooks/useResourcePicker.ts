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
     * to match, and then DERIVE it from that checkpoint. Never a hardcoded
     * ecosystem string: a literal pins every viewer of the app to whichever
     * family the author happened to be testing with. Nor a literal reached
     * through a fallback — `checkpoint?.baseModel ?? 'SDXL'` re-pins every viewer
     * who has not picked yet, which is the same defect wearing a default.
     *
     * 🔴 WHERE THE FAMILY COMES FROM ON THIS HOOK'S ONLY SURFACE. This hook is
     * PAGE-ONLY (`OPEN_RESOURCE_PICKER` is a page affordance; the model slot has
     * the narrower `useCheckpointPicker` instead), and a page slot carries no
     * checkpoint: `checkpoint` exists on `ModelSlotContext` alone, and
     * `BlockContext` is a union with no index signature, so
     * `useBlockContext().context.checkpoint` does not even typecheck. The source
     * is {@link BlockResourceInfo}`.baseModel` — the `baseModel` of a Checkpoint
     * THIS picker returned earlier:
     *
     *     const checkpoint = await open({ resourceType: 'Checkpoint' });
     *     if (checkpoint) await open({ resourceType: 'LORA', baseModelGroup: checkpoint.baseModel });
     *
     * Accepts an ecosystem key (e.g. 'Flux1', 'SDXL') OR a baseModel name (e.g.
     * 'Flux.1 D'); the host collapses either to the ecosystem family. `''` is not
     * a way to widen: the page host drops a zero-length value, so it is only ever
     * a confusing spelling of omitting the key.
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
 * 🔴 THE ORDER OF THE TWO `@example` BLOCKS BELOW IS LOAD-BEARING — DO NOT SWAP
 * THEM. `<civitai-developer-docs>/scripts/gen-appblocks-hooks.mjs` assigns
 * `jsdocExample` inside its tag loop, so on a hook with several `@example` tags
 * the LAST one wins and becomes the single published example whenever the README
 * fence is unavailable (renamed heading, dropped fence). The unconstrained call
 * is what every agent should copy, so it is last. The constrained variant is
 * first, where a human reading top-down still meets the exception before the
 * default it excepts.
 *
 * @example
 * // CONSTRAINED — only when the pick has to match a checkpoint the block
 * // already holds. Derive the family from THAT checkpoint; a hardcoded
 * // ecosystem here hides every resource outside it from the viewer. On a page
 * // block the checkpoint comes from this same picker, not from the context.
 * const { open } = useResourcePicker();
 * const checkpoint = await open({ resourceType: 'Checkpoint' });
 * if (checkpoint) {
 *   const lora = await open({ resourceType: 'LORA', baseModelGroup: checkpoint.baseModel });
 *   // feed lora?.versionId into body.additionalResources and submit
 * }
 *
 * @example
 * // THE DEFAULT — no ecosystem filter at all. The viewer sees every LoRA they
 * // can reach, which is almost always what you want.
 * const { open } = useResourcePicker();
 * const picked = await open({ resourceType: 'LORA' });
 * if (picked) {
 *   // feed picked.versionId into body.additionalResources and submit
 * }
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
