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
 *    valid `WorkflowBody`;
 *  - the `customComfy` member is ITSELF a union on `mode`, mirroring the host's
 *    `blockCustomComfyMemberSchema`: a recipe arm (`mode` omitted or
 *    `'recipe'`) and an inline-graph arm (`mode: 'inline'`, carrying
 *    `workflow`/`resources`/`maxBuzz`). Both directions are pinned — an inline
 *    body must be assignable, and a recipe body must NOT be able to carry
 *    inline-only fields (or vice versa) — because a type that merely compiles
 *    is not a type that matches the wire;
 *  - the `step` member (`kind: 'step'`) mirrors the host's `blockStepBodySchema`
 *    exactly — `{ kind, step, params }` and nothing else, since that schema is
 *    `.strict()` — and is the ONLY way a block can reach the host's step
 *    registry (`'convert-image'`, `'chat-completion'`, …).
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
  InlineComfyNode,
  WorkflowBody,
  WorkflowBodyCustomComfy,
  WorkflowBodyCustomComfyInline,
  WorkflowBodyCustomComfyRecipe,
  WorkflowBodyStep,
  WorkflowBodyTextToImage,
} from '../../src/blocks/types.js';

/** The `textToImage` member, narrowed out of the union for member-field asserts. */
type TextToImage = Extract<WorkflowBody, { kind: 'textToImage' }>;
/** The `customComfy` member, narrowed out of the union. */
type CustomComfy = Extract<WorkflowBody, { kind: 'customComfy' }>;
/** The RECIPE arm of the `customComfy` member. */
type ComfyRecipe = Extract<CustomComfy, { mode?: 'recipe' }>;
/** The INLINE arm of the `customComfy` member. */
type ComfyInline = Extract<CustomComfy, { mode: 'inline' }>;
/** The `step` member, narrowed out of the union. */
type Step = Extract<WorkflowBody, { kind: 'step' }>;

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
expectTypeOf<Step>().toEqualTypeOf<WorkflowBodyStep>();
expectTypeOf<WorkflowBody>().toEqualTypeOf<
  WorkflowBodyTextToImage | WorkflowBodyCustomComfy | WorkflowBodyStep
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

// --- customComfy RECIPE params shape: prompt required; seed/engine/accountType optional ---
expectTypeOf<ComfyRecipe['params']>().toEqualTypeOf<{
  prompt: string;
  seed?: number | null;
  engine?: string;
  accountType?: 'blue' | 'green' | 'yellow';
}>();

// ── customComfy is ITSELF a union on `mode` (civitai's inline-graph arm) ──────
//
// The exported member type IS the two arms and nothing else. Pinning the union
// (rather than just "an inline body compiles") is what catches a future edit
// that collapses it back to a single object type — which is exactly the state
// that produced the false "the iframe never sends a graph" claim.
expectTypeOf<CustomComfy>().toEqualTypeOf<
  WorkflowBodyCustomComfyRecipe | WorkflowBodyCustomComfyInline
>();
expectTypeOf<WorkflowBodyCustomComfy>().toEqualTypeOf<
  WorkflowBodyCustomComfyRecipe | WorkflowBodyCustomComfyInline
>();

// The recipe arm's `mode` is OPTIONAL and only ever `'recipe'`. This is the
// back-compat property: the host declares it `z.literal('recipe').optional()`
// so a body that omits `mode` lands on the recipe arm. A required literal here
// would break every deployed block.
expectTypeOf<ComfyRecipe['mode']>().toEqualTypeOf<'recipe' | undefined>();
// The inline arm's `mode` is REQUIRED — you cannot reach the inline path by
// merely including a `workflow` key.
expectTypeOf<ComfyInline['mode']>().toEqualTypeOf<'inline'>();

// A recipe body with NO `mode` key still satisfies the union (back-compat).
const comfyNoMode: WorkflowBody = {
  kind: 'customComfy',
  recipe: 'seamless-pano-360',
  params: { prompt: 'an equirectangular vista' },
};
expectTypeOf(comfyNoMode).toMatchTypeOf<WorkflowBody>();

// …and so does one that names it explicitly.
const comfyExplicitRecipeMode: WorkflowBody = {
  kind: 'customComfy',
  mode: 'recipe',
  recipe: 'seamless-pano-360',
  params: { prompt: 'an equirectangular vista' },
};
expectTypeOf(comfyExplicitRecipeMode).toMatchTypeOf<WorkflowBody>();

// --- an INLINE-GRAPH body is a valid WorkflowBody ---------------------------
const inlineBody: WorkflowBody = {
  kind: 'customComfy',
  mode: 'inline',
  resources: ['urn:air:sdxl:checkpoint:civitai:101055@128078'],
  workflow: {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'urn:air:sdxl:checkpoint:civitai:101055@128078' },
    },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a mountain', clip: ['1', 1] } },
  },
  prompt: 'a mountain',
  maxBuzz: 60,
};
expectTypeOf(inlineBody).toMatchTypeOf<WorkflowBody>();

// The inline arm's key set mirrors the host's `.strict()`
// `blockInlineComfyBodySchema` exactly — nothing more, nothing less. A field
// this arm does NOT list is rejected at the wire rather than dropped, and
// several of the names the orchestrator's own `CustomComfyInput` carries
// (`comfyImage`, `minVramGb`, `sessionOwnerApiToken`) are deliberately
// unreachable from a block. Pinning the key set is what makes this a mirror.
expectTypeOf<keyof ComfyInline>().toEqualTypeOf<
  'kind' | 'mode' | 'workflow' | 'resources' | 'prompt' | 'negativePrompt' | 'maxBuzz'
>();

// The graph is a node map, and a node is exactly `{ class_type, inputs }` —
// the host's `inlineComfyNodeSchema` is `.strict()`, so a `_meta` key from a
// raw ComfyUI export is REJECTED, not ignored.
expectTypeOf<ComfyInline['workflow']>().toEqualTypeOf<Record<string, InlineComfyNode>>();
expectTypeOf<keyof InlineComfyNode>().toEqualTypeOf<'class_type' | 'inputs'>();
expectTypeOf<InlineComfyNode['class_type']>().toEqualTypeOf<string>();
expectTypeOf<InlineComfyNode['inputs']>().toEqualTypeOf<Record<string, unknown>>();

// `resources` is REQUIRED, not optional: the declared AIR manifest is the whole
// entitlement surface, and an omitted-but-inferred manifest is precisely the
// mistake the containment gate rejects. `maxBuzz` is REQUIRED for the same
// reason — it IS the step timeout, so there is no server default to fall back
// on.
expectTypeOf<ComfyInline['resources']>().toEqualTypeOf<string[]>();
expectTypeOf<ComfyInline['maxBuzz']>().toEqualTypeOf<number>();
// The declared prompts are optional (the host defaults both to '').
expectTypeOf<ComfyInline['prompt']>().toEqualTypeOf<string | undefined>();
expectTypeOf<ComfyInline['negativePrompt']>().toEqualTypeOf<string | undefined>();

// The two arms do not bleed into each other. An inline body has no `recipe`
// and no `params`; a recipe body has no graph. Both host schemas are
// `.strict()`, so a body naming fields from both is rejected by BOTH arms.
expectTypeOf<ComfyInline>().not.toHaveProperty('recipe');
expectTypeOf<ComfyInline>().not.toHaveProperty('params');
expectTypeOf<ComfyRecipe>().not.toHaveProperty('workflow');
expectTypeOf<ComfyRecipe>().not.toHaveProperty('resources');
expectTypeOf<ComfyRecipe>().not.toHaveProperty('maxBuzz');

// There is no top-level `accountType` on the inline arm — unlike `textToImage`,
// and unlike the recipe arm's `params.accountType`. The host resolves an inline
// body's funding to Auto.
expectTypeOf<ComfyInline>().not.toHaveProperty('accountType');

// --- narrowing INSIDE the customComfy member, on `mode` ---------------------
// 🔴 The narrow must be on the VALUE (`mode === 'inline'`), never on the
// presence of the key: the recipe arm sets `mode` as an own key in two of its
// three legal spellings, so a presence test routes a valid recipe body down the
// inline path. This block is the compile-time half of that rule.
declare const comfyBody: WorkflowBodyCustomComfy;
if (comfyBody.mode === 'inline') {
  expectTypeOf(comfyBody.workflow).toEqualTypeOf<Record<string, InlineComfyNode>>();
  expectTypeOf(comfyBody.resources).toEqualTypeOf<string[]>();
  expectTypeOf(comfyBody.maxBuzz).toEqualTypeOf<number>();
} else {
  expectTypeOf(comfyBody.recipe).toEqualTypeOf<string>();
  expectTypeOf(comfyBody.params.prompt).toEqualTypeOf<string>();
}

// --- step member: a registered-step body is a valid WorkflowBody ---
const stepBody: WorkflowBody = {
  kind: 'step',
  step: 'chat-completion',
  params: {
    model: 'deepseek/deepseek-chat',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 128,
  },
};
expectTypeOf(stepBody).toMatchTypeOf<WorkflowBody>();

// --- the step member mirrors `blockStepBodySchema` EXACTLY: three fields ---
// The host schema is `.strict()`, so a fourth field here would be rejected at
// the wire rather than dropped. Pinning the key set is what makes this a mirror
// rather than a lookalike.
expectTypeOf<keyof Step>().toEqualTypeOf<'kind' | 'step' | 'params'>();
expectTypeOf<Step['step']>().toEqualTypeOf<string>();
expectTypeOf<Step['params']>().toEqualTypeOf<Record<string, unknown>>();

// Notably there is NO top-level `accountType` on this arm — unlike the
// `textToImage` member. The host schema does not accept one.
expectTypeOf<Step>().not.toHaveProperty('accountType');
expectTypeOf<Step>().not.toHaveProperty('recipe');

// --- narrowing on `kind` exposes the right member fields ---
declare const someBody: WorkflowBody;
if (someBody.kind === 'textToImage') {
  expectTypeOf(someBody.modelId).toEqualTypeOf<number>();
} else if (someBody.kind === 'customComfy') {
  // Narrowing on `kind` alone leaves the `mode` union — `recipe` is NOT
  // readable here, which is the point: the compiler forces the second narrow
  // rather than letting a consumer assume every customComfy body is a recipe.
  expectTypeOf(someBody.mode).toEqualTypeOf<'recipe' | 'inline' | undefined>();
} else {
  expectTypeOf(someBody.step).toEqualTypeOf<string>();
}
