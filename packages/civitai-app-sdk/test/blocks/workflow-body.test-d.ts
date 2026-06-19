/**
 * Compile-time coverage for the `WorkflowBody` contract — specifically that the
 * optional `additionalResources` (LoRA) field is backward-compatible and
 * matches civitai's `blockWorkflowBodySchema` shape from PRs #2640/#2641
 * (`{ modelVersionId: number; strength?: number }`, optional, array-of).
 *
 * This is a TYPE test: it is compiled by `tsc -p tsconfig.typecheck.json`
 * (the `test:types` script, run by `pnpm test`). If the type shape regresses,
 * tsc fails — there is nothing to execute at runtime.
 *
 * The `expectTypeOf` assertions resolve against `tsconfig.typecheck.json`,
 * which includes `src/**` + this file so the SDK types are in scope.
 */
import { expectTypeOf } from 'vitest';

import type { WorkflowBody } from '../../src/blocks/types.js';

const baseParams = { prompt: 'a cat' } as const;

// --- backward compatible: a checkpoint-only body (no additionalResources) ---
const checkpointOnly: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  params: baseParams,
};
expectTypeOf(checkpointOnly).toMatchTypeOf<WorkflowBody>();

// --- additionalResources is OPTIONAL (its type includes `undefined`) ---
expectTypeOf<WorkflowBody['additionalResources']>().toEqualTypeOf<
  Array<{ modelVersionId: number; strength?: number }> | undefined
>();

// --- with LoRAs: strength is optional per-entry, default applied server-side ---
const withLoras: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  additionalResources: [
    { modelVersionId: 100, strength: 0.8 },
    { modelVersionId: 200 }, // strength omitted -> server defaults to 1
  ],
  params: baseParams,
};
expectTypeOf(withLoras.additionalResources).toMatchTypeOf<
  Array<{ modelVersionId: number; strength?: number }> | undefined
>();

// --- an empty additionalResources array also type-checks ---
const emptyLoras: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  additionalResources: [],
  params: baseParams,
};
expectTypeOf(emptyLoras.additionalResources).toMatchTypeOf<
  Array<{ modelVersionId: number; strength?: number }> | undefined
>();

// --- each entry: modelVersionId required, strength optional (exact shape) ---
expectTypeOf<
  NonNullable<WorkflowBody['additionalResources']>[number]
>().toEqualTypeOf<{ modelVersionId: number; strength?: number }>();
