/**
 * WIRE-PARITY fixtures for the `customComfy` inline arm, TRANSCRIBED FROM THE
 * HOST'S OWN SCHEMA TESTS.
 *
 * `workflow-body.test-d.ts` already pins the SHAPE of our types against itself:
 * key sets, optionality, the union, the `mode` narrow. That is necessary and it
 * is not sufficient — every one of those assertions is written against the same
 * mental model as the type it checks, so a type that is internally coherent and
 * WRONG ABOUT THE WIRE passes all of them. That is precisely the failure this
 * arc is about: `WorkflowBodyCustomComfy` type-checked fine for months while
 * describing a contract the host no longer had.
 *
 * So the payloads below are not invented here. They are copied from civitai's
 * `src/server/schema/blocks/__tests__/workflow.schema.inline-comfy.test.ts` —
 * the bodies the host's OWN suite runs through `blockWorkflowBodySchema` and
 * asserts on. If a body the host accepts does not satisfy our type, or a body
 * the host REJECTS does satisfy it, this file goes red. That makes the
 * assertions answerable by a source outside this repo, which is the only thing
 * that can catch a shared wrong assumption.
 *
 * 🔴 KEEP IN LOCKSTEP with those two host files:
 *   - `src/server/schema/blocks/workflow.schema.ts`
 *     (`blockCustomComfyBodySchema` / `blockInlineComfyBodySchema` /
 *      `blockCustomComfyMemberSchema`)
 *   - `src/server/schema/blocks/__tests__/workflow.schema.inline-comfy.test.ts`
 *     (the fixtures transcribed below)
 */

import { expectTypeOf } from 'vitest';
import type {
  WorkflowBody,
  WorkflowBodyCustomComfy,
  WorkflowBodyCustomComfyInline,
} from '../../src/blocks/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE HOST'S `inlineBody()` FIXTURE, VERBATIM.
//
// From `workflow.schema.inline-comfy.test.ts`:
//
//   function inlineBody(over: Record<string, unknown> = {}) {
//     return {
//       kind: 'customComfy',
//       mode: 'inline',
//       workflow: {
//         '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
//         '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
//       },
//       resources: [],
//       maxBuzz: 60,
//       ...over,
//     };
//   }
//
// The host asserts `blockWorkflowBodySchema.safeParse(inlineBody()).success ===
// true`, so this object MUST satisfy our type.
//
// 🔴 Two properties of this fixture are load-bearing and easy to miss:
//   - it declares NO `prompt` and NO `negativePrompt`. The host defaults both to
//     `''` (`z.string().default('')`), so on the INPUT side they are optional.
//     A type that made either required would reject a body the host accepts.
//   - `resources` is `[]` — present but EMPTY. Empty is legal (a graph naming no
//     AIR declares no AIR); ABSENT is not, because the field has no default.
// ─────────────────────────────────────────────────────────────────────────────
const hostInlineFixture: WorkflowBody = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
  },
  resources: [],
  maxBuzz: 60,
};
expectTypeOf(hostInlineFixture).toMatchTypeOf<WorkflowBody>();
// …and it lands on the INLINE arm specifically, not merely "somewhere in the union".
expectTypeOf(hostInlineFixture).toMatchTypeOf<WorkflowBodyCustomComfy>();
const hostInlineFixtureNarrowed: WorkflowBodyCustomComfyInline = hostInlineFixture as Extract<
  WorkflowBody,
  { kind: 'customComfy'; mode: 'inline' }
>;
expectTypeOf(hostInlineFixtureNarrowed).toMatchTypeOf<WorkflowBodyCustomComfyInline>();

// The same fixture with the two declared prompts SET (the host's `over` spread
// exercises this) — still valid, so they are optional-not-forbidden.
const hostInlineFixtureWithPrompts: WorkflowBody = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  },
  resources: [],
  prompt: 'a cat',
  negativePrompt: 'blurry',
  maxBuzz: 60,
};
expectTypeOf(hostInlineFixtureWithPrompts).toMatchTypeOf<WorkflowBody>();

// ─────────────────────────────────────────────────────────────────────────────
// 2. BACK-COMPAT: the host's recipe fixtures, verbatim.
//
// From the same file's "the pre-existing members still parse (back-compat)"
// block. The first is THE shape every deployed block and every body written
// against an earlier `@civitai/app-sdk` sends — no `mode` key at all. The host
// asserts its parsed output is `toStrictEqual` the input, i.e. byte-identical.
// If making `WorkflowBodyCustomComfy` a union had broken this, THIS is the
// assertion that would go red.
// ─────────────────────────────────────────────────────────────────────────────
const hostRecipeFixtureNoMode: WorkflowBody = {
  kind: 'customComfy',
  recipe: 'seamless-pano-360',
  params: { prompt: 'a sunset', engine: 'zimage-turbo' },
};
expectTypeOf(hostRecipeFixtureNoMode).toMatchTypeOf<WorkflowBody>();

const hostRecipeFixtureExplicitMode: WorkflowBody = {
  kind: 'customComfy',
  mode: 'recipe',
  recipe: 'seamless-pano-360',
  params: { prompt: 'a sunset' },
};
expectTypeOf(hostRecipeFixtureExplicitMode).toMatchTypeOf<WorkflowBody>();

// ─────────────────────────────────────────────────────────────────────────────
// 3. 🔴 THE NEVER-APP-SETTABLE FIELDS — the negative half.
//
// The host's `blockInlineComfyBodySchema` is `.strict()`, and its suite pins
// that each of these is REJECTED (describe block: "inline arm rejects every
// CustomComfyInput field an app must not set"). Each is a real capability on the
// orchestrator's `CustomComfyInput`: an app that could set one would get,
// respectively, a Civitai API token belonging to the session owner, an arbitrary
// container to run, a different worker tier (and so a different Buzz/second rate
// than the whole ceiling argument assumes), worker session affinity, an
// attention-kernel flag, a submit-time affordability gate, and a trace mode.
//
// A type carrying an index signature — or one that simply LISTED any of these —
// would let a block author write the body, ship it, and discover at runtime that
// the wire rejects it. TypeScript's excess-property check on a fresh object
// literal is what makes these `@ts-expect-error`s bite; each one FAILS THE
// TYPECHECK if the field ever becomes assignable.
//
// The `@ts-expect-error` directive is itself the assertion: if the error stops
// occurring, tsc reports "Unused '@ts-expect-error' directive" and this file
// goes red. That is the direction that matters here — it cannot silently pass.
// ─────────────────────────────────────────────────────────────────────────────
const forbiddenSessionOwnerApiToken: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `sessionOwnerApiToken` is not on the wire contract — the host `.strict()`-rejects it.
  sessionOwnerApiToken: 'civitai-api-token',
};
void forbiddenSessionOwnerApiToken;

const forbiddenComfyImage: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `comfyImage` (an arbitrary OCI container AIR) is not on the wire contract.
  comfyImage: 'urn:air:oci:image:ghcr:evil/comfy@v1',
};
void forbiddenComfyImage;

const forbiddenMinVramGb: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `minVramGb` would change the worker tier, and so the Buzz/second rate.
  minVramGb: 48,
};
void forbiddenMinVramGb;

const forbiddenSessionId: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `sessionId` (worker session affinity) is not on the wire contract.
  sessionId: 'sess_1',
};
void forbiddenSessionId;

const forbiddenUseSageAttention: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `useSageAttention` is not on the wire contract.
  useSageAttention: true,
};
void forbiddenUseSageAttention;

const forbiddenMinimumDurationSeconds: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `minimumDurationSeconds` is not on the wire contract.
  minimumDurationSeconds: 300,
};
void forbiddenMinimumDurationSeconds;

const forbiddenTrace: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error `trace` is not on the wire contract.
  trace: 'binary',
};
void forbiddenTrace;

// ─────────────────────────────────────────────────────────────────────────────
// 4. POSITIVE CONTROL for section 3.
//
// The host's own suite carries one ("the same body WITHOUT the extra field
// parses") for exactly this reason: without it, all seven assertions above could
// be passing because the BASE fixture is malformed for some unrelated reason,
// and the `@ts-expect-error`s would be swallowing a completely different error.
// This is the same object with no extra key, and it must type-check clean.
// ─────────────────────────────────────────────────────────────────────────────
const forbiddenFieldsPositiveControl: WorkflowBodyCustomComfyInline = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
};
expectTypeOf(forbiddenFieldsPositiveControl).toMatchTypeOf<WorkflowBodyCustomComfyInline>();

// ─────────────────────────────────────────────────────────────────────────────
// 5. The two arms are MUTUALLY EXCLUSIVE, per the host's
//    "a body naming both is rejected" test. Both host arms are `.strict()`, so a
//    body carrying `recipe` AND `workflow` is rejected by BOTH — there is no
//    ambiguity for the union to resolve, and our type must not resolve one
//    either.
// ─────────────────────────────────────────────────────────────────────────────
const bothArms: WorkflowBody = {
  kind: 'customComfy',
  mode: 'inline',
  workflow: { '1': { class_type: 'X', inputs: {} } },
  resources: [],
  maxBuzz: 60,
  // @ts-expect-error an inline body may not also name a `recipe` — the host rejects it at both arms.
  recipe: 'seamless-pano-360',
};
void bothArms;

// …and the mirror image: a recipe body that also declares `mode: 'inline'` is
// rejected by the host (it lands on the inline arm, which then has no
// `workflow`/`resources`/`maxBuzz`). Our union must not accept it either.
//
// Note WHERE tsc puts the error: `mode: 'inline'` successfully selects the
// inline arm, so the complaint is about `recipe` being unknown ON THAT ARM —
// not about `mode`. That is the same reasoning the host's discriminated union
// performs, and it is why the directive sits on `recipe`. (Discovered by
// running it, not assumed: the directive was first written above `mode` and
// tsc reported "Unused '@ts-expect-error' directive" there.)
const recipeBodyClaimingInline: WorkflowBody = {
  kind: 'customComfy',
  mode: 'inline',
  // @ts-expect-error `mode: 'inline'` selects the inline arm, which has no `recipe` — the host rejects this body too.
  recipe: 'seamless-pano-360',
  params: { prompt: 'a sunset' },
};
void recipeBodyClaimingInline;
