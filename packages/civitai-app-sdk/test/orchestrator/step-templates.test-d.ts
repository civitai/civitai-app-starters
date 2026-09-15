/**
 * Compile-time coverage for `src/orchestrator/steps.ts` — the type-only
 * re-export of the orchestrator's generated workflow-step templates.
 *
 * This is a TYPE test: it is compiled by `tsc -p tsconfig.typecheck.json` (the
 * `test:types` script, run by `pnpm test`). There is nothing to execute.
 *
 * WHAT WOULD MAKE IT RED — each assertion below names a concrete regression,
 * because a type test that passes whether or not the feature exists proves
 * nothing:
 *
 *  1. A step template that stops being exported (or is renamed by a
 *     `@civitai/client` bump) → TS2305 on the import at the top of this file.
 *  2. `WorkflowStepTemplates` losing a key, or the orchestrator spec gaining a
 *     step type the catalog does not know → the key-parity assertion fails.
 *  3. The exports degrading to the LOOSE base `WorkflowStepTemplate` (whose
 *     `$type` is a bare `string`, so it accepts anything) → the
 *     `@ts-expect-error` blocks stop erroring, and an unused `@ts-expect-error`
 *     is itself a compile error. This is the positive control: without it,
 *     every other assertion here would still pass against a type that had
 *     silently stopped discriminating.
 *  4. The `input` shape drifting from the spec → the literal-valued
 *     construction below fails (it pins `prompt` / `cfgScale` / `seed` as
 *     REQUIRED, which is what the spec says and is easy to get wrong by hand).
 */
import { expectTypeOf } from 'vitest';

import type { WorkflowStepType } from '../../src/orchestrator/index.js';
import type {
  AnyWorkflowStepTemplate,
  ComfyStepTemplate,
  Model3dPreviewStepTemplate,
  TextToImageStepTemplate,
  TypedWorkflowTemplate,
  VideoGenStepTemplate,
  WorkflowStepInputFor,
  WorkflowStepTemplate,
  WorkflowStepTemplateFor,
  WorkflowStepTemplates,
  WorkflowTemplate,
} from '../../src/orchestrator/steps.js';

// ---------------------------------------------------------------------------
// 1. Construct a real step template through the new export.
// ---------------------------------------------------------------------------

// Literal values, not `as` casts or `{} as T` — a cast would satisfy any type
// and assert nothing about the shape.
const textToImage: WorkflowStepTemplateFor<'textToImage'> = {
  $type: 'textToImage',
  name: 'step_0',
  timeout: '00:10:00',
  input: {
    prompt: 'a fox in the snow',
    // REQUIRED by the spec even though most hand-written copies treat them as
    // optional. Delete either line and this file stops compiling.
    cfgScale: 5,
    seed: 1234,
    model: 'urn:air:sdxl:checkpoint:civitai:101055@128078',
    width: 1024,
    height: 1024,
    steps: 25,
    quantity: 1,
  },
};

expectTypeOf(textToImage).toEqualTypeOf<TextToImageStepTemplate>();
expectTypeOf(textToImage.$type).toEqualTypeOf<'textToImage'>();

// A whole submit body composed out of the narrowed union.
const body: TypedWorkflowTemplate = {
  tags: ['app-sdk-type-test'],
  steps: [textToImage],
};
expectTypeOf(body.steps).toEqualTypeOf<AnyWorkflowStepTemplate[]>();

// ---------------------------------------------------------------------------
// 2. The discriminant is a LITERAL, not `string` (positive control).
// ---------------------------------------------------------------------------

// If these exports ever degrade to the base `WorkflowStepTemplate`, whose
// `$type` is a bare `string`, the errors below disappear and TypeScript then
// reports the unused `@ts-expect-error` — so this cannot silently pass.
const wrongDiscriminant: WorkflowStepTemplateFor<'textToImage'> = {
  // @ts-expect-error — 'videoGen' is not assignable to 'textToImage'
  $type: 'videoGen',
  input: { prompt: 'x', cfgScale: 5, seed: 1 },
};
void wrongDiscriminant;

const missingRequiredInput: WorkflowStepTemplateFor<'textToImage'> = {
  $type: 'textToImage',
  // @ts-expect-error — `cfgScale` and `seed` are required on TextToImageInput
  input: { prompt: 'x' },
};
void missingRequiredInput;

// The BASE type deliberately does NOT discriminate — asserted, so that a
// future edit substituting it for the union is visible rather than silent.
expectTypeOf<WorkflowStepTemplate['$type']>().toEqualTypeOf<string>();
expectTypeOf<WorkflowStepTemplate['$type']>().not.toEqualTypeOf<'textToImage'>();

// ---------------------------------------------------------------------------
// 3. Key parity with the WORKFLOW_STEP_TYPES catalog.
// ---------------------------------------------------------------------------

// The catalog is pinned to the orchestrator spec's discriminator mapping (see
// `src/orchestrator/index.ts` and `scripts/check-orchestrator-catalogs.mjs`).
//
// Direction A — every key in the map is a real catalog entry. A typo, or a
// phantom `$type` (the catalog itself once carried an `audioMix` that appears
// nowhere in the spec), fails here.
expectTypeOf<Exclude<keyof WorkflowStepTemplates, WorkflowStepType>>().toEqualTypeOf<never>();

/**
 * Direction B — catalog entries that have NO generated type yet.
 *
 * 🔴 A LEDGER, NOT A TOGGLE. Empty (`never`) today: the catalog's 47 `$type`s
 * and `@civitai/client@0.2.0-beta.98`'s 47 generated step templates are the
 * same set, verified by enumeration, not by sampling.
 *
 * The two surfaces move independently and are allowed to disagree for a while:
 * the catalog tracks the LIVE orchestrator spec (`pnpm check:catalogs` and the
 * `sync-orchestrator-catalogs` automation keep it there), while these types
 * track whatever `@civitai/client` was last published from. At the time of
 * writing the live spec already had three step types — `imageScanning`,
 * `preprocessVideo`, `yuE2` — that neither the catalog nor the pinned client
 * carried.
 *
 * So when the catalog syncs ahead of the client, list the not-yet-typed
 * `$type`s HERE in the same PR, and delete them when the client republishes.
 * Spelled as a ledger rather than dropped, because an unasserted gap is
 * indistinguishable from no gap — and spelled as a `never` rather than as a
 * hard equality, because coupling a REQUIRED check to an external package's
 * republish cadence is how a gate becomes permanently red.
 */
type CatalogStepTypesWithoutAGeneratedType = never;
expectTypeOf<Exclude<WorkflowStepType, keyof WorkflowStepTemplates>>().toEqualTypeOf<
  CatalogStepTypesWithoutAGeneratedType
>();

// Every member of the map really is a step template (not, say, an `*Input`).
expectTypeOf<WorkflowStepTemplates['comfy']>().toEqualTypeOf<ComfyStepTemplate>();
expectTypeOf<WorkflowStepTemplates['videoGen']>().toEqualTypeOf<VideoGenStepTemplate>();
// The wire name and the generated type name disagree on case here — the map is
// what papers over it, so pin it.
expectTypeOf<WorkflowStepTemplates['model3DPreview']>().toEqualTypeOf<Model3dPreviewStepTemplate>();

// ---------------------------------------------------------------------------
// 4. Derived helpers.
// ---------------------------------------------------------------------------

expectTypeOf<WorkflowStepInputFor<'textToImage'>>().toEqualTypeOf<
  TextToImageStepTemplate['input']
>();

// `AnyWorkflowStepTemplate` is a real discriminated union: narrowing works.
expectTypeOf<Extract<AnyWorkflowStepTemplate, { $type: 'comfy' }>>().toEqualTypeOf<
  ComfyStepTemplate
>();

// `TypedWorkflowTemplate` keeps the envelope's other fields and narrows only
// `steps`.
expectTypeOf<TypedWorkflowTemplate['tags']>().toEqualTypeOf<WorkflowTemplate['tags']>();
expectTypeOf<TypedWorkflowTemplate['metadata']>().toEqualTypeOf<WorkflowTemplate['metadata']>();
expectTypeOf<WorkflowTemplate['steps']>().toEqualTypeOf<WorkflowStepTemplate[]>();

// ---------------------------------------------------------------------------
// 5. The one deliberate divergence from the generated types: `currencies`.
// ---------------------------------------------------------------------------

// The spec marks `currencies` REQUIRED on `WorkflowTemplate`, so the generated
// type does too — but this package's own body builders have never emitted it
// and civitai's orchestrator services pass it as `undefined`. Both halves are
// pinned so that neither the generated type nor our relaxation can move
// silently: if a client bump makes `currencies` optional upstream, the first
// assertion fails and this whole divergence (and its docs) can be deleted.
const generated: WorkflowTemplate = { steps: [], currencies: [] };
void generated;
// @ts-expect-error — REQUIRED on the generated type; drop this line and the
// assertion below stops proving there is anything to diverge from.
const generatedWithoutCurrencies: WorkflowTemplate = { steps: [] };
void generatedWithoutCurrencies;

// …and OPTIONAL on ours.
const typedWithoutCurrencies: TypedWorkflowTemplate = { steps: [textToImage] };
void typedWithoutCurrencies;
// Still accepted when supplied, and still the generated element type.
const typedWithCurrencies: TypedWorkflowTemplate = { steps: [textToImage], currencies: [] };
void typedWithCurrencies;
expectTypeOf<NonNullable<TypedWorkflowTemplate['currencies']>>().toEqualTypeOf<
  NonNullable<WorkflowTemplate['currencies']>
>();
