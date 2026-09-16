/**
 * Orchestrator workflow-step TYPES, keyed by wire `$type` over the orchestrator's
 * own generated client (`@civitai/client`).
 *
 * The sibling `@civitai/app-sdk/orchestrator` module gives you the *catalog*
 * (`WORKFLOW_STEP_TYPES` — 47 `$type` names and what each one does) and the
 * fetch helpers (`submitWorkflow`, `estimateWorkflow`, …), but its body
 * builders take `input: unknown`. This module is the missing half: the actual
 * per-step input shapes, tracked against the orchestrator's OpenAPI spec by
 * codegen instead of by hand.
 *
 * What this module adds on top of `@civitai/client` is the `$type` → template
 * MAP (`WorkflowStepTemplates`) and the lookups derived from it. The generated
 * template types themselves are `@civitai/client`'s, and since that package is
 * a required install for this subpath anyway (its names appear in this module's
 * emitted declarations), import them straight from it when you need one by
 * name:
 *
 * ```ts
 * import type { TextToImageStepTemplate } from '@civitai/client';
 * ```
 *
 * Reaching for `WorkflowStepTemplateFor<'textToImage'>` is usually better: the
 * generated name is not always the one you would guess from the wire name
 * (`model3DPreview` → `Model3dPreviewStepTemplate`), and looking it up is the
 * discoverability tax the map exists to remove.
 *
 * ```ts
 * import { createOrchestratorClient, submitWorkflow } from '@civitai/app-sdk/orchestrator';
 * import type {
 *   TypedWorkflowTemplate,
 *   WorkflowStepTemplateFor,
 * } from '@civitai/app-sdk/orchestrator/steps';
 *
 * const step: WorkflowStepTemplateFor<'textToImage'> = {
 *   $type: 'textToImage',
 *   name: 'step_0',
 *   input: {
 *     prompt: 'a fox',
 *     model: 'urn:air:sdxl:checkpoint:civitai:101055@128078',
 *     // REQUIRED on textToImage — easy to miss when hand-writing the body,
 *     // and the kind of thing these types exist to catch.
 *     cfgScale: 5,
 *     seed: 1234,
 *   },
 * };
 * const body: TypedWorkflowTemplate = { steps: [step], tags: ['my-app'] };
 * await submitWorkflow(createOrchestratorClient({ accessToken }), body);
 * ```
 *
 * ## 🔴 THIS IS TYPE SURFACE. IT IS NOT PERMISSION SURFACE.
 *
 * A `$type` having a type here says **nothing** about whether you are allowed
 * to submit it. Two separate things decide that, and neither is affected by
 * this module:
 *
 *  - **App Blocks** (iframe blocks embedded in civitai.com) do not talk to the
 *    orchestrator at all. They post a `WorkflowBody` to the host, which
 *    validates it against its own server-side `blockWorkflowBodySchema`. That
 *    contract lives in this package's `blocks/types.ts` and is untouched here —
 *    importing a step type does not widen it by one field.
 *  - **Standalone apps / BFFs** submit to the orchestrator directly with the
 *    user's OAuth token, and the orchestrator applies its own authorization.
 *    A body that compiles can still come back 400 or 403.
 *
 * The practical consequence: a number of the 47 step types below exist to serve
 * Civitai's own pipelines rather than third-party apps — `modelPickleScan`,
 * `xGuardModeration`, `training`, `comfyNodepackSnapshot`, `qwenImageBench`,
 * the `model*` / `media*` hashing and classification steps. They are in the
 * consumer spec, so they are typed here. They are not an invitation.
 *
 * ⚠️ `WORKFLOW_STEP_TYPES` does NOT mark most of them. Counted at this commit:
 * of its 47 entries, exactly TWO sit under its "Platform internals" heading —
 * `comfyNodepackSnapshot` and `qwenImageBench`. `training`, `webScrape`,
 * `xGuardModeration`, `modelPickleScan` and the `model*` / `media*` steps are
 * ordinary documented entries under ordinary headings, and `webScrape` carries
 * consumer-facing usage notes. So "the catalog already flags these as internal"
 * is not a reason this map covers all 47, and an earlier version of this
 * docblock claiming it was is wrong. What IS true, and is the reason: the
 * catalog DOCUMENTS all 47, and a lookup keyed by `$type` is only sound as a
 * lookup if it is total over `WorkflowStepType` — a partial map makes
 * `WorkflowStepTemplateFor<'training'>` a compile error for a step type the
 * SDK documents, and makes the key-parity assertion below impossible.
 *
 * ## Why this is a separate deep entry point
 *
 * `@civitai/client` is an **optional peer**, not a dependency (see the
 * `comment-peerDependencies` block in this package's package.json). Keeping
 * this module out of `./orchestrator` and `.` means an app that never imports
 * `@civitai/app-sdk/orchestrator/steps` never needs the peer installed. If you
 * DO import this module, install it:
 *
 * ```sh
 * pnpm add -D @civitai/client@beta
 * ```
 *
 * 🔴 **FORGETTING THE PEER IS SILENT UNDER `skipLibCheck: true`, WHICH IS THE
 * DEFAULT.** The unresolved `@civitai/client` import lands in the emitted
 * `steps.d.ts`, so `skipLibCheck` — which every starter in this repo sets, as
 * does `tsc --init` — suppresses its `TS2307` along with every other
 * declaration-file diagnostic. Every export here then resolves to `any`: the
 * code below still compiles, and checks NOTHING.
 *
 * Measured against a built copy of this package, in a consumer resolving
 * through the exports map with the peer uninstalled:
 *
 *  - `skipLibCheck: true` — **0 diagnostics**, on a file annotating
 *    `WorkflowStepTemplateFor<'textToImage'>` with a bogus `$type`, an
 *    unknown `input` field AND an unknown envelope field. A planted
 *    `const x: number = 's'` in the same project DID error, so that zero is a
 *    real zero. Reinstalling the peer turns those three into errors.
 *  - `skipLibCheck: false` — one error,
 *    `TS2307: Cannot find module '@civitai/client'`, reported against
 *    `node_modules/@civitai/app-sdk/dist/orchestrator/steps.d.ts` rather than
 *    against your own file.
 *
 * 🔴 There is no type-level guard that can close this, and that was measured
 * rather than assumed. A sentinel conditional (`0 extends 1 & WorkflowTemplate
 * ? …`) does not fire: TypeScript gives an unresolved import an ERROR type
 * which propagates as `any` through any type-level computation over it, so the
 * detector itself resolves to `any`. Verified in an isolated two-package repro
 * against a working control — with the module resolvable the probe reports
 * correctly and a deliberate mismatch errors; with it unresolvable every
 * assertion, including the positive control, passes. So the mitigation is
 * documentation, and the containment is that only THIS subpath is affected.
 *
 * 🔴 **Install from the `beta` tag, not `latest`.** `@civitai/client`'s npm
 * `latest` dist-tag points at `0.1.1-beta.0`, ~97 betas behind the `beta` tag
 * the orchestrator is actually generated against, and missing most of the step
 * types below. A plain `pnpm add @civitai/client` installs the stale one with
 * no error; the first symptom is `TextToImageStepTemplate` not existing.
 *
 * ## Runtime cost: zero
 *
 * Every import and export here is type-only, so the emitted
 * `dist/orchestrator/steps.js` is an empty module and no bundler ever follows
 * an edge into `@civitai/client`. That is not a promise, it is a test:
 * `test/orchestrator/steps-type-only.test.ts` compiles this file and asserts
 * the emitted JavaScript contains no import of `@civitai/client`.
 */

import type {
  // ----- Base shapes -------------------------------------------------------
  WorkflowTemplate,

  // ----- Image gen ---------------------------------------------------------
  TextToImageStepTemplate,
  ImageGenStepTemplate,
  ComfyStepTemplate,
  CustomComfyStepTemplate,
  ImageUpscalerStepTemplate,
  ImageBackgroundRemovalStepTemplate,
  ImageToSvgStepTemplate,
  ImageResourceTrainingStepTemplate,
  PreprocessImageStepTemplate,
  ConvertImageStepTemplate,
  ImageUploadStepTemplate,

  // ----- Video gen ---------------------------------------------------------
  VideoGenStepTemplate,
  VideoUpscalerStepTemplate,
  VideoInterpolationStepTemplate,
  VideoEnhancementStepTemplate,
  VideoFrameExtractionStepTemplate,
  VideoBackgroundRemovalStepTemplate,
  VideoMetadataStepTemplate,
  TranscodeStepTemplate,

  // ----- Audio -------------------------------------------------------------
  TextToSpeechStepTemplate,
  AceStepAudioStepTemplate,
  MiniMaxMusic3StepTemplate,
  TranscriptionStepTemplate,
  AudioCaptioningStepTemplate,

  // ----- Media composition -------------------------------------------------
  ComposeMediaStepTemplate,

  // ----- 3D ----------------------------------------------------------------
  PolyGenStepTemplate,
  Model3dPreviewStepTemplate,

  // ----- Training ----------------------------------------------------------
  TrainingStepTemplate,

  // ----- Classification / tagging / moderation -----------------------------
  MediaHashStepTemplate,
  ModelHashStepTemplate,
  MediaRatingStepTemplate,
  MediaCaptioningStepTemplate,
  WdTaggingStepTemplate,
  AgeClassificationStepTemplate,
  XGuardModerationStepTemplate,
  ShieldstralModerationStepTemplate,
  ModelClamScanStepTemplate,
  ModelPickleScanStepTemplate,
  ModelParseMetadataStepTemplate,

  // ----- LLM ---------------------------------------------------------------
  ChatCompletionStepTemplate,
  PromptEnhancementStepTemplate,

  // ----- Web ---------------------------------------------------------------
  WebScrapeStepTemplate,
  WebSearchStepTemplate,

  // ----- Utility -----------------------------------------------------------
  EchoStepTemplate,
  BlobArchiveStepTemplate,

  // ----- Platform internals ------------------------------------------------
  ComfyNodepackSnapshotStepTemplate,
  QwenImageBenchStepTemplate,
} from '@civitai/client';

// ---------------------------------------------------------------------------
// Keyed map + derived helpers
// ---------------------------------------------------------------------------

/**
 * `$type` → its step-template type, for all 47 step types.
 *
 * Keyed by the WIRE name rather than the generated type name, because the wire
 * name is what you actually have in hand and the generator does not always
 * spell it the way you would guess (`model3DPreview` →
 * `Model3dPreviewStepTemplate`).
 *
 * `test/orchestrator/step-templates.test-d.ts` asserts this key set equals
 * `WORKFLOW_STEP_TYPES` (the catalog in `@civitai/app-sdk/orchestrator`, itself
 * pinned to the orchestrator spec's discriminator mapping) at COMPILE TIME,
 * BOTH directions, via an explicit `never` ledger for the gap. What that does
 * and does not buy:
 *
 *  - a key here that the catalog does not list (a typo, or a phantom `$type`
 *    like the `audioMix` the catalog itself once carried) fails the typecheck;
 *  - a catalog entry with no key here fails the typecheck, so this map cannot
 *    quietly fall behind the catalog;
 *  - it does NOT see the orchestrator gaining a step type that neither the
 *    catalog nor the pinned client knows about. That is the catalog's own
 *    drift check's job (`pnpm check:catalogs`, which re-fetches the LIVE spec).
 *
 * The two can legitimately disagree for a while: the catalog tracks the live
 * spec, while these types track whatever `@civitai/client` was last published
 * from. When the catalog syncs ahead, name the not-yet-typed step types in the
 * test's ledger in the same PR, and clear them when the client republishes.
 */
export interface WorkflowStepTemplates {
  aceStepAudio: AceStepAudioStepTemplate;
  ageClassification: AgeClassificationStepTemplate;
  audioCaptioning: AudioCaptioningStepTemplate;
  blobArchive: BlobArchiveStepTemplate;
  chatCompletion: ChatCompletionStepTemplate;
  comfy: ComfyStepTemplate;
  comfyNodepackSnapshot: ComfyNodepackSnapshotStepTemplate;
  composeMedia: ComposeMediaStepTemplate;
  convertImage: ConvertImageStepTemplate;
  customComfy: CustomComfyStepTemplate;
  echo: EchoStepTemplate;
  imageBackgroundRemoval: ImageBackgroundRemovalStepTemplate;
  imageGen: ImageGenStepTemplate;
  imageResourceTraining: ImageResourceTrainingStepTemplate;
  imageToSvg: ImageToSvgStepTemplate;
  imageUpload: ImageUploadStepTemplate;
  imageUpscaler: ImageUpscalerStepTemplate;
  mediaCaptioning: MediaCaptioningStepTemplate;
  mediaHash: MediaHashStepTemplate;
  mediaRating: MediaRatingStepTemplate;
  miniMaxMusic3: MiniMaxMusic3StepTemplate;
  model3DPreview: Model3dPreviewStepTemplate;
  modelClamScan: ModelClamScanStepTemplate;
  modelHash: ModelHashStepTemplate;
  modelParseMetadata: ModelParseMetadataStepTemplate;
  modelPickleScan: ModelPickleScanStepTemplate;
  polyGen: PolyGenStepTemplate;
  preprocessImage: PreprocessImageStepTemplate;
  promptEnhancement: PromptEnhancementStepTemplate;
  qwenImageBench: QwenImageBenchStepTemplate;
  shieldstralModeration: ShieldstralModerationStepTemplate;
  textToImage: TextToImageStepTemplate;
  textToSpeech: TextToSpeechStepTemplate;
  training: TrainingStepTemplate;
  transcode: TranscodeStepTemplate;
  transcription: TranscriptionStepTemplate;
  videoBackgroundRemoval: VideoBackgroundRemovalStepTemplate;
  videoEnhancement: VideoEnhancementStepTemplate;
  videoFrameExtraction: VideoFrameExtractionStepTemplate;
  videoGen: VideoGenStepTemplate;
  videoInterpolation: VideoInterpolationStepTemplate;
  videoMetadata: VideoMetadataStepTemplate;
  videoUpscaler: VideoUpscalerStepTemplate;
  wdTagging: WdTaggingStepTemplate;
  webScrape: WebScrapeStepTemplate;
  webSearch: WebSearchStepTemplate;
  xGuardModeration: XGuardModerationStepTemplate;
}

/**
 * The step template for one `$type`.
 *
 * @example
 * type Tti = WorkflowStepTemplateFor<'textToImage'>;
 */
export type WorkflowStepTemplateFor<T extends keyof WorkflowStepTemplates> =
  WorkflowStepTemplates[T];

/**
 * The `input` shape for one `$type` — the per-step payload, without having to
 * know or import the generated `*Input` name. This is why neither the 47
 * `*Input` types nor the 47 `*StepTemplate` types are re-exported one by one:
 * the lookup is keyed by the wire `$type` you already have, and the generated
 * names remain importable from `@civitai/client` for anyone who wants them.
 *
 * @example
 * function buildVideo(input: WorkflowStepInputFor<'videoGen'>) { … }
 */
export type WorkflowStepInputFor<T extends keyof WorkflowStepTemplates> =
  WorkflowStepTemplates[T]['input'];

/**
 * Discriminated union of every step template — discriminate on `$type`.
 *
 * `@civitai/client`'s base `WorkflowStepTemplate` has `$type` as a bare
 * `string`, so it narrows nothing. This union is what makes
 * `Extract<…, { $type: 'comfy' }>` and an exhaustive `switch` work.
 */
export type AnyWorkflowStepTemplate =
  WorkflowStepTemplates[keyof WorkflowStepTemplates];

/**
 * A submit body whose `steps` are the narrowed union rather than
 * `@civitai/client`'s base `WorkflowStepTemplate[]`.
 *
 * Assignable straight into `submitWorkflow` / `estimateWorkflow` from
 * `@civitai/app-sdk/orchestrator`, whose `body` parameter is `unknown`. Those
 * signatures are deliberately NOT narrowed to this type: that would drag
 * `@civitai/client` into the main `./orchestrator` entry point and make the
 * optional peer mandatory for everyone.
 *
 * 🔴 ONE DELIBERATE DIVERGENCE FROM THE GENERATED TYPE: `currencies` is
 * OPTIONAL here, where `WorkflowTemplate` has it REQUIRED.
 *
 * The orchestrator's OpenAPI spec really does list `currencies` under
 * `WorkflowTemplate.required` (`["currencies","steps"]`), so the generated type
 * is faithful — but nothing else behaves as if it were required:
 * `buildTextToImageBody` / `buildImageGenBody` / `buildWorkflowBody` in
 * `@civitai/app-sdk/orchestrator` have never emitted it, every starter submits
 * through them, and civitai's own orchestrator services pass
 * `currencies: undefined` on several paths and read it back with `?.`.
 *
 * Taking the generated type literally would therefore produce a type that
 * contradicts this package's own working helpers, and would make every existing
 * caller stop compiling.
 *
 * ⚠️ BE HONEST ABOUT WHICH DIRECTION THIS IS. The spec's own description of the
 * field is "Limit the currencies that can be used to pay for this workflow."
 * (read from `WorkflowTemplate.properties.currencies.description` in the live
 * spec) — it is a LIMITER, so omitting it is the PERMISSIVE choice, not the
 * safe one, and it sits on a spend-scoping field. (An earlier version of this
 * comment called omitting it "conservative". That was backwards, in the one
 * direction that matters.) What the relaxation is conservative ABOUT is this
 * package's API: it forbids nothing that compiled before, requires nothing new
 * of callers, and matches what the helpers have always sent. If you want a
 * workflow's payment scoped to particular currencies, pass `currencies`
 * explicitly — the field is still here and still the generated element type.
 *
 * Pinned by `test/orchestrator/step-templates.test-d.ts` so the divergence
 * cannot widen unnoticed.
 *
 * NOT VERIFIED against a live submit — doing so costs real Buzz. The evidence
 * above is the spec, this package's helpers, and civitai's call sites.
 */
export type TypedWorkflowTemplate = Omit<WorkflowTemplate, 'steps' | 'currencies'> & {
  steps: AnyWorkflowStepTemplate[];
  currencies?: WorkflowTemplate['currencies'];
};
