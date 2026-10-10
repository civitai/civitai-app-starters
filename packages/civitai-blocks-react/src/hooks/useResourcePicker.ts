import { useCallback } from 'react';

import type { BlockResourceInfo, BlockResourcePickerType } from '@civitai/app-sdk/blocks';

import { throwOnReplyError } from '../internal/replyError.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/**
 * The most resources ONE multi-select `open({ multiple })` can return — the
 * same cap the generation body puts on `additionalResources`, so a full batch
 * is always one a submit accepts. A larger `multiple.max` is CLAMPED to this.
 */
export const RESOURCE_PICKER_MULTIPLE_MAX = 5;

/** The options every {@link UseResourcePicker} `open` call takes. */
export interface ResourcePickerOpenOptions {
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
}

/**
 * Multi-select: let the viewer pick up to `max` resources in ONE picker session.
 *
 * - **LoRA only.** `open({ resourceType: 'Checkpoint', multiple })` is a type
 *   error, and at runtime it REJECTS — it is never quietly treated as a single
 *   pick. A generation takes one checkpoint and a list of LoRAs.
 * - **`max` is a whole number ≥ 1.** Anything above
 *   {@link RESOURCE_PICKER_MULTIPLE_MAX} (5) is CLAMPED to it; anything that is
 *   not a whole number ≥ 1 rejects.
 * - `baseModelGroup` works exactly as it does for a single pick.
 */
export interface ResourcePickerMultiple {
  max: number;
}

/** What {@link useResourcePicker} returns. */
export interface UseResourcePicker {
  open: {
    /**
     * Single pick. Resolves with the chosen resource, or `null` when the viewer
     * dismissed the picker.
     */
    (opts: ResourcePickerOpenOptions & { multiple?: undefined }): Promise<BlockResourceInfo | null>;
    /**
     * Multi-select (see {@link ResourcePickerMultiple}). Resolves with the
     * picked resources IN THE ORDER THE VIEWER PICKED THEM — never more than
     * `max` — or `[]` when the viewer dismissed. Each entry is the same
     * {@link BlockResourceInfo} a single pick returns.
     *
     * Against a host that predates multi-select the viewer gets the single-pick
     * picker, and this still resolves with a list: of the one resource they
     * picked, or `[]`.
     */
    (
      opts: ResourcePickerOpenOptions & { resourceType: 'LORA'; multiple: ResourcePickerMultiple },
    ): Promise<BlockResourceInfo[]>;
  };
}

/**
 * The LoRA family, lower-cased. The host's picker accepts `LoCon` and `DoRA`
 * beside `LORA` and matches case-insensitively, so the runtime check here does
 * too — a caller reaching those through a cast is not refused by the SDK for
 * something the host allows.
 */
const MULTIPLE_RESOURCE_TYPES: ReadonlySet<string> = new Set(['lora', 'locon', 'dora']);

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
 * MULTI-SELECT: pass `multiple: { max }` with `resourceType: 'LORA'` and the
 * viewer picks up to `max` LoRAs (at most {@link RESOURCE_PICKER_MULTIPLE_MAX})
 * in ONE picker session. `open` then resolves with a LIST — the picks in the
 * order the viewer made them, `[]` on dismiss — instead of a single resource.
 * See {@link ResourcePickerMultiple}. Without `multiple`, nothing about a
 * single pick changes.
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
 * 🔴 THE ORDER OF THE `@example` BLOCKS BELOW IS LOAD-BEARING — DO NOT MOVE
 * THE LAST ONE. `<civitai-developer-docs>/scripts/gen-appblocks-hooks.mjs` assigns
 * `jsdocExample` inside its tag loop, so on a hook with several `@example` tags
 * the LAST one wins and becomes the single published example whenever the README
 * fence is unavailable (renamed heading, dropped fence). The unconstrained call
 * is what every agent should copy, so it is last. The constrained variant is
 * first, where a human reading top-down still meets the exception before the
 * default it excepts; the multi-select variant sits between them.
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
 * // MULTI-SELECT — several LoRAs in one picker session, in pick order.
 * const { open } = useResourcePicker();
 * const loras = await open({ resourceType: 'LORA', multiple: { max: 3 } });
 * // [] when dismissed; otherwise up to 3 picks, in the order the viewer chose
 * const additionalResources = loras.map((lora) => ({
 *   modelVersionId: lora.versionId,
 *   strength: lora.strength ?? 1,
 * }));
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
    async (
      opts: ResourcePickerOpenOptions & { multiple?: ResourcePickerMultiple | null },
    ): Promise<BlockResourceInfo | BlockResourceInfo[] | null> => {
      if (opts.multiple == null) {
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
      }

      // ── Multi-select ──────────────────────────────────────────────────────
      // Refused HERE, before anything is sent, for two reasons: the caller gets
      // an error naming the mistake instead of a picker that never opens, and a
      // host that predates multi-select never sees a request it would answer
      // with the wrong thing (it ignores `multiple` and would happily open a
      // single CHECKPOINT pick).
      if (!MULTIPLE_RESOURCE_TYPES.has(String(opts.resourceType).trim().toLowerCase())) {
        throw new Error(
          `useResourcePicker: \`multiple\` is only supported for LoRA picks, not ` +
            `resourceType "${String(opts.resourceType)}". Call open() without \`multiple\` for a single pick.`,
        );
      }
      const requestedMax: unknown = (opts.multiple as { max?: unknown }).max;
      if (typeof requestedMax !== 'number' || !Number.isInteger(requestedMax) || requestedMax < 1) {
        throw new Error(
          'useResourcePicker: `multiple.max` must be a whole number of at least 1 ' +
            `(values above ${RESOURCE_PICKER_MULTIPLE_MAX} are clamped to ${RESOURCE_PICKER_MULTIPLE_MAX}).`,
        );
      }
      const max = Math.min(requestedMax, RESOURCE_PICKER_MULTIPLE_MAX);

      const result = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_RESOURCE_PICKER',
          payload: {
            resourceType: opts.resourceType,
            ...(opts.baseModelGroup != null ? { baseModelGroup: opts.baseModelGroup } : {}),
            multiple: { max },
          },
        },
        'RESOURCE_PICKER_RESULT',
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      // The host answers a multi request it will not open with `{ error }`.
      throwOnReplyError(result, 'The host refused the multi-select resource picker request.');

      // A host that knows multi-select answers `selectedResources` (`[]` on
      // dismiss). One that predates it ignored `multiple`, opened a single pick
      // and answered `selected` (or nothing, on dismiss) — still a list here, of
      // one or none, so the caller has ONE result shape to handle either way.
      const picked = Array.isArray(result.selectedResources)
        ? result.selectedResources
        : result.selected
          ? [result.selected]
          : [];
      // Belt: never hand back more than was asked for.
      return picked.slice(0, max);
    },
    [],
  ) as UseResourcePicker['open'];

  return { open };
}
