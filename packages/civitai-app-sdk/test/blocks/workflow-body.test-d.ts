/**
 * Compile-time coverage for the `WorkflowBody` contract:
 *  - the optional `additionalResources` (LoRA) field on the `textToImage`
 *    member is backward-compatible and matches civitai's
 *    `blockWorkflowBodySchema` shape from PRs #2640/#2641
 *    (`{ modelVersionId: number; strength?: number }`, optional, array-of);
 *  - `WorkflowBody` is now a REAL discriminated union — an existing
 *    `{ kind: 'textToImage', … }` body still satisfies it unchanged
 *    (mandatory back-compat), and the new `customComfy` recipe member is a
 *    valid `WorkflowBody`.
 *
 * This is a TYPE test: it is compiled by `tsc -p tsconfig.typecheck.json`
 * (the `test:types` script, run by `pnpm test`). If the type shape regresses,
 * tsc fails — there is nothing to execute at runtime.
 *
 * The `expectTypeOf` assertions resolve against `tsconfig.typecheck.json`,
 * which includes `src/**` + this file so the SDK types are in scope.
 */
import { expectTypeOf } from 'vitest';

import type {
  WorkflowBody,
  WorkflowBodyCustomComfy,
  WorkflowBodyTextToImage,
} from '../../src/blocks/types.js';

/** The `textToImage` member, narrowed out of the union for member-field asserts. */
type TextToImage = Extract<WorkflowBody, { kind: 'textToImage' }>;
/** The `customComfy` member, narrowed out of the union. */
type CustomComfy = Extract<WorkflowBody, { kind: 'customComfy' }>;

const baseParams = { prompt: 'a cat' } as const;

// --- BACK-COMPAT (mandatory): the original single-member shape still satisfies
//     WorkflowBody unchanged — a checkpoint-only body (no additionalResources) ---
const checkpointOnly: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  params: baseParams,
};
expectTypeOf(checkpointOnly).toMatchTypeOf<WorkflowBody>();

// --- the exported member types line up with the union arms ---
expectTypeOf<TextToImage>().toEqualTypeOf<WorkflowBodyTextToImage>();
expectTypeOf<CustomComfy>().toEqualTypeOf<WorkflowBodyCustomComfy>();
expectTypeOf<WorkflowBody>().toEqualTypeOf<
  WorkflowBodyTextToImage | WorkflowBodyCustomComfy
>();

// --- additionalResources is OPTIONAL on the textToImage member ---
expectTypeOf<TextToImage['additionalResources']>().toEqualTypeOf<
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
expectTypeOf(withLoras).toMatchTypeOf<WorkflowBody>();

// --- an empty additionalResources array also type-checks ---
const emptyLoras: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  additionalResources: [],
  params: baseParams,
};
expectTypeOf(emptyLoras).toMatchTypeOf<WorkflowBody>();

// --- each entry: modelVersionId required, strength optional (exact shape) ---
expectTypeOf<
  NonNullable<TextToImage['additionalResources']>[number]
>().toEqualTypeOf<{ modelVersionId: number; strength?: number }>();

// --- customComfy member: a registered-recipe body is a valid WorkflowBody ---
const customComfyMinimal: WorkflowBody = {
  kind: 'customComfy',
  recipe: 'seamless-pano-360',
  params: { prompt: 'an equirectangular vista' },
};
expectTypeOf(customComfyMinimal).toMatchTypeOf<WorkflowBody>();

const customComfyFull: WorkflowBody = {
  kind: 'customComfy',
  recipe: 'seamless-pano-360',
  params: {
    prompt: 'an equirectangular vista',
    seed: 42,
    engine: 'zimage-turbo',
    accountType: 'yellow',
  },
};
expectTypeOf(customComfyFull).toMatchTypeOf<WorkflowBody>();

// --- customComfy params shape: prompt required; seed/engine/accountType optional ---
expectTypeOf<CustomComfy['params']>().toEqualTypeOf<{
  prompt: string;
  seed?: number | null;
  engine?: string;
  accountType?: 'blue' | 'green' | 'yellow';
}>();

// --- narrowing on `kind` exposes the right member fields ---
declare const someBody: WorkflowBody;
if (someBody.kind === 'textToImage') {
  expectTypeOf(someBody.modelId).toEqualTypeOf<number>();
} else {
  expectTypeOf(someBody.recipe).toEqualTypeOf<string>();
}
