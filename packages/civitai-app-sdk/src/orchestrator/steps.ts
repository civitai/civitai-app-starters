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
 * 🔴 **WITHOUT A GUARD, FORGETTING THE PEER IS SILENT UNDER
 * `skipLibCheck: true`, WHICH IS THE DEFAULT.** The unresolved
 * `@civitai/client` import lands in the emitted `steps.d.ts`, so `skipLibCheck`
 * — which every starter in this repo sets, as does `tsc --init` — suppresses
 * its `TS2307` along with every other declaration-file diagnostic. The exports
 * here then degrade to an error type that behaves like `any`, and the code
 * below still compiles while checking NOTHING.
 *
 * **That hole is now closed by `GuardPeer` (below), and this is the
 * measurement.** A consumer installing this package's built `dist`, resolving
 * through the exports map, `skipLibCheck: true`,
 * `"moduleResolution": "Bundler"`, TypeScript 5.9.3. Four source files: a
 * correct step template + envelope, a file with a bogus `$type` and an unknown
 * `input` field, a file whose only defect is an unknown envelope field, and a
 * planted `const x: number = 's'` so a zero is distinguishable from a compiler
 * wired to nothing.
 *
 * | build | peer | diagnostics |
 * |---|---|---|
 * | before the guard | installed | 4 — the three real defects, plus the planted control |
 * | before the guard | missing | **1 — the planted control alone.** The three defects report nothing |
 * | with the guard | installed | 4 — byte-identical to the row above it |
 * | with the guard | missing | 5 — a `TS2322` on each annotation **in the consumer's own file**, naming the install command, plus the planted control |
 *
 * With `skipLibCheck: false` and no guard you get one error,
 * `TS2307: Cannot find module '@civitai/client'`, reported against
 * `node_modules/@civitai/app-sdk/dist/orchestrator/steps.d.ts` rather than
 * against your own file.
 *
 * 🔴 **THE SAME DEGRADATION HAPPENS WITH THE PEER INSTALLED, UNDER
 * `NodeNext`/`Node16`.** `@civitai/client@0.2.0-beta.98` is published with
 * `"type": "module"`, no `exports` map, and extensionless relative re-exports
 * (`export * from './generated'`), which Node's ESM resolution does not
 * resolve. Measured in the same consumer with the peer present, only
 * `moduleResolution` changed: before the guard, `NodeNext` gave **1
 * diagnostic — the planted control alone**, i.e. the subpath was checking
 * nothing despite a correctly installed peer; with the guard it reports, which
 * is why the message names this case as well as the missing-peer one. Use
 * `"moduleResolution": "Bundler"` (what every starter here and this package
 * itself set).
 *
 * The guard's two arms are pinned by `test/orchestrator/steps-peer-guard.test.ts`,
 * which compiles a consumer against this module's own emitted declarations with
 * the peer resolvable and unresolvable. It was watched to fail at the commit
 * before the guard existed.
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
// Peer-resolution guard
// ---------------------------------------------------------------------------

/**
 * `true` when `@civitai/client`'s types did not resolve for the compiler that
 * is reading this module.
 *
 * TypeScript gives an unresolved import an ERROR type. That type behaves like
 * `any` in most positions — which is why the exports below would otherwise
 * check nothing under `skipLibCheck: true` — but `keyof` over it is
 * `string | number | symbol`, not `any`. So `string extends keyof T` separates
 * the two cases: FALSE for every generated template (whose keys are a finite
 * union of literals), TRUE for the error type.
 *
 * `string extends keyof T` is only sound as a detector if no real template
 * carries a string index signature. Enumerated over all 47 mapped templates
 * plus the base `WorkflowStepTemplate` at `@civitai/client@0.2.0-beta.98`:
 * none does, and the probe was checked in both directions (a synthetic
 * `{ [k: string]: unknown }` reports TRUE, each real template reports FALSE).
 */
type PeerTypesUnresolved = string extends keyof TextToImageStepTemplate ? true : false;

/**
 * What a consumer sees instead of a step type when the peer did not resolve.
 *
 * A string literal type rather than `never`: assigning an object literal to it
 * produces a `TS2322` **in the consumer's own file** whose text is this
 * sentence, where the unguarded version produced no diagnostic at all.
 */
type PeerTypesUnresolvedError =
  "@civitai/app-sdk/orchestrator/steps is not type-checking: @civitai/client's types did not resolve. Install the peer with `pnpm add -D @civitai/client@beta`. If it IS installed, this subpath needs `\"moduleResolution\": \"Bundler\"` — the published package does not resolve under NodeNext/Node16.";

/** Collapses a lookup to the message above when the peer did not resolve. */
type GuardPeer<T> = [PeerTypesUnresolved] extends [true] ? PeerTypesUnresolvedError : T;

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
export type WorkflowStepTemplateFor<T extends keyof WorkflowStepTemplates> = GuardPeer<
  WorkflowStepTemplates[T]
>;

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
export type WorkflowStepInputFor<T extends keyof WorkflowStepTemplates> = GuardPeer<
  WorkflowStepTemplates[T]['input']
>;

/**
 * Discriminated union of every step template — discriminate on `$type`.
 *
 * `@civitai/client`'s base `WorkflowStepTemplate` has `$type` as a bare
 * `string`, so it narrows nothing. This union is what makes
 * `Extract<…, { $type: 'comfy' }>` and an exhaustive `switch` work.
 */
export type AnyWorkflowStepTemplate = GuardPeer<
  WorkflowStepTemplates[keyof WorkflowStepTemplates]
>;

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
 * ⚠️ WHAT IS ESTABLISHED, AND WHAT IS NOT. The spec marks `currencies`
 * required, and describes it — `WorkflowTemplate.properties.currencies
 * .description` in the live spec — as "Limit the currencies that can be used to
 * pay for this workflow." That description says what the field does WHEN
 * PRESENT. **What the orchestrator does when it is omitted is unverified**: the
 * spec licenses no inference either way, and the candidates (rejected as
 * invalid, unlimited, or scoped to some server-side default) are not
 * distinguishable from the document. This relaxation is about THIS package's
 * API — it forbids nothing that compiled before, requires nothing new of
 * callers, and matches what the helpers have always sent. If you want a
 * workflow's payment scoped to particular currencies, pass `currencies`
 * explicitly — the field is still here and still the generated element type.
 *
 * Pinned by `test/orchestrator/step-templates.test-d.ts` so the divergence
 * cannot widen unnoticed.
 *
 * NOT VERIFIED against a live submit — doing so costs real Buzz. The evidence
 * above is the spec, this package's helpers, and civitai's call sites.
 */
export type TypedWorkflowTemplate = GuardPeer<
  Omit<WorkflowTemplate, 'steps' | 'currencies'> & {
    steps: AnyWorkflowStepTemplate[];
    currencies?: WorkflowTemplate['currencies'];
  }
>;
