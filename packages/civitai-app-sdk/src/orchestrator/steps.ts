/**
 * Orchestrator workflow-step TYPES, re-exported from the orchestrator's own
 * generated client (`@civitai/client`).
 *
 * The sibling `@civitai/app-sdk/orchestrator` module gives you the *catalog*
 * (`WORKFLOW_STEP_TYPES` — 47 `$type` names and what each one does) and the
 * fetch helpers (`submitWorkflow`, `estimateWorkflow`, …), but its body
 * builders take `input: unknown`. This module is the missing half: the actual
 * per-step input shapes, tracked against the orchestrator's OpenAPI spec by
 * codegen instead of by hand.
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
 *   input: { prompt: 'a fox', model: 'urn:air:sdxl:checkpoint:civitai:101055@128078' },
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
 * The practical consequence: roughly 13 of the 47 step types below are platform
 * internals (`modelPickleScan`, `xGuardModeration`, `webScrape`, `training`,
 * `comfyNodepackSnapshot`, `qwenImageBench`, the `model*` / `media*` hashing
 * and classification steps, …). They are in the consumer spec, so they are
 * typed here for completeness and for key parity with `WORKFLOW_STEP_TYPES` —
 * which already lists them, under an explicit "Platform internals" heading.
 * They are not an invitation.
 *
 * ## Why this is a separate deep entry point
 *
 * `@civitai/client` is an **optional peer**, not a dependency (see the
 * `comment-peerDependencies` block in this package's package.json). Keeping
 * these re-exports out of `./orchestrator` and `.` means an app that never
 * imports `@civitai/app-sdk/orchestrator/steps` never needs the peer installed
 * and never sees a resolution error. If you DO import this module, install it:
 *
 * ```sh
 * pnpm add -D @civitai/client@beta
 * ```
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
  WorkflowStepTemplate,
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

export type {
  /**
   * The fields every step template shares (`name`, `priority`, `timeout`,
   * `retries`, `metadata`), with `$type` left as a bare `string`. Prefer
   * {@link AnyWorkflowStepTemplate}, which narrows `$type` to the real union.
   */
  WorkflowStepTemplate,
  /**
   * The submit envelope: `{ metadata?, tags?, steps }`. Its `steps` is the
   * LOOSE `WorkflowStepTemplate[]`; {@link TypedWorkflowTemplate} narrows it.
   */
  WorkflowTemplate,
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
  VideoGenStepTemplate,
  VideoUpscalerStepTemplate,
  VideoInterpolationStepTemplate,
  VideoEnhancementStepTemplate,
  VideoFrameExtractionStepTemplate,
  VideoBackgroundRemovalStepTemplate,
  VideoMetadataStepTemplate,
  TranscodeStepTemplate,
  TextToSpeechStepTemplate,
  AceStepAudioStepTemplate,
  MiniMaxMusic3StepTemplate,
  TranscriptionStepTemplate,
  AudioCaptioningStepTemplate,
  ComposeMediaStepTemplate,
  PolyGenStepTemplate,
  /** Note the lowercase `d` — the generator emits `Model3d`, not `Model3D`. */
  Model3dPreviewStepTemplate,
  TrainingStepTemplate,
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
  ChatCompletionStepTemplate,
  PromptEnhancementStepTemplate,
  WebScrapeStepTemplate,
  WebSearchStepTemplate,
  EchoStepTemplate,
  BlobArchiveStepTemplate,
  ComfyNodepackSnapshotStepTemplate,
  QwenImageBenchStepTemplate,
};

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
 * know or import the generated `*Input` name. This is why the 47 `*Input`
 * types are deliberately NOT re-exported one by one.
 *
 * @example
 * function buildVideo(input: WorkflowStepInputFor<'videoGen'>) { … }
 */
export type WorkflowStepInputFor<T extends keyof WorkflowStepTemplates> =
  WorkflowStepTemplates[T]['input'];

/**
 * Discriminated union of every step template — discriminate on `$type`.
 *
 * The base `WorkflowStepTemplate.$type` is a bare `string`, so the base type
 * narrows nothing. This union is what makes `Extract<…, { $type: 'comfy' }>`
 * and an exhaustive `switch` work.
 */
export type AnyWorkflowStepTemplate =
  WorkflowStepTemplates[keyof WorkflowStepTemplates];

/**
 * A submit body whose `steps` are the narrowed union rather than the base
 * `WorkflowStepTemplate[]`.
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
 * contradicts this package's own working helpers, and would push callers into
 * sending a payment-currency restriction they never intended. Relaxing it is
 * the conservative direction: it forbids nothing and requires nothing new.
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
