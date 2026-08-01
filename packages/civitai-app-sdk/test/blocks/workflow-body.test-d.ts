/**
 * Compile-time coverage for the `WorkflowBody` contract:
 *  - the optional `additionalResources` (LoRA) field on the `textToImage`
 *    member is backward-compatible and matches civitai's
 *    `blockWorkflowBodySchema` shape from PRs #2640/#2641
 *    (`{ modelVersionId: number; strength?: number }`, optional, array-of);
 *  - the optional `sourceImages` (multi-image conditioning) field mirrors
 *    civitai's `blockTextToImageBodySchema.sourceImages` element-for-element
 *    (`BlockSourceImage[]`), and the deprecated singular `sourceImage` alias is
 *    still present and unchanged;
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
  BlockSourceImage,
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

// --- sourceImages[]: multi-image conditioning (civitai#3518) ---------------
// The array is OPTIONAL, and its element type is EXACTLY `BlockSourceImage`
// (`{ url, width, height }`, all required) — the same element contract the
// deprecated singular field has. A mismatch here (e.g. an element type with
// optional width/height, or a widened `unknown[]`) is invisible until a runtime
// 400 from the server, so pin it at compile time.
expectTypeOf<TextToImage['sourceImages']>().toEqualTypeOf<
  BlockSourceImage[] | undefined
>();
expectTypeOf<NonNullable<TextToImage['sourceImages']>[number]>().toEqualTypeOf<{
  url: string;
  width: number;
  height: number;
}>();
// The deprecated singular alias is UNCHANGED and still present (removing it
// would break every deployed block).
expectTypeOf<TextToImage['sourceImage']>().toEqualTypeOf<
  BlockSourceImage | undefined
>();

// A multi-image body satisfies WorkflowBody.
const withSourceImages: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  sourceImages: [
    { url: 'https://civitai.com/a.jpeg', width: 1024, height: 1024 },
    { url: 'https://image.civitai.com/b.jpeg', width: 512, height: 768 },
  ],
  params: baseParams,
};
expectTypeOf(withSourceImages).toMatchTypeOf<WorkflowBody>();

// A 1-element array is the drop-in replacement for the deprecated singular
// field (server-side they normalize to the same graph input).
const withOneSourceImage: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  sourceImages: [{ url: 'https://civitai.com/a.jpeg', width: 1024, height: 1024 }],
  params: baseParams,
};
expectTypeOf(withOneSourceImage).toMatchTypeOf<WorkflowBody>();

// The deprecated singular form still satisfies WorkflowBody (back-compat).
const withDeprecatedSingular: WorkflowBody = {
  kind: 'textToImage',
  modelId: 1,
  modelVersionId: 2,
  sourceImage: { url: 'https://civitai.com/a.jpeg', width: 1024, height: 1024 },
  params: baseParams,
};
expectTypeOf(withDeprecatedSingular).toMatchTypeOf<WorkflowBody>();

// A source image is NOT expressible on the customComfy member (recipes own
// their own graph) — `sourceImages` exists only on the textToImage arm.
expectTypeOf<CustomComfy>().not.toHaveProperty('sourceImages');

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
