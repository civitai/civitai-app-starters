/**
 * Public type surface for the `@civitai/app-sdk/blocks` subpath.
 *
 * Framework-agnostic. Hooks and transport classes that consume these types
 * live in a separate package so this module stays usable from any runtime.
 */

import type { BlockCategory } from './scopes.js';

// ============================================================
// Runtime context delivered to a block at init
// ============================================================

/**
 * Per-instance context the host page passes to the block at mount time.
 *
 * `slotId` is the only field guaranteed to be present; every other field
 * depends on which slot the block is rendered into. Authors who target a
 * specific slot should narrow to a slot-specific context type
 * (e.g. {@link ModelSlotContext}) rather than reaching into the index
 * signature.
 *
 * Mirrors `SlotContext` in civitai/civitai's `src/components/AppBlocks/types.ts`.
 */
export interface BlockContext {
  slotId: string;
  [key: string]: unknown;
}

/**
 * Snapshot of the effective Checkpoint the block will generate against —
 * already merged from publisher default + viewer override on the host.
 * For Checkpoint-bound installs this is the model itself; for LoRA installs
 * it's whichever Checkpoint the resolver picked.
 *
 * `null` (via `ModelSlotContext.checkpoint`) means no checkpoint is
 * configured; blocks should render a "missing checkpoint" CTA pointing the
 * user at the model owner.
 *
 * Mirrors `BlockCheckpointInfo` in civitai/civitai's
 * `src/components/AppBlocks/types.ts`.
 */
export interface BlockCheckpointInfo {
  versionId: number;
  modelId: number;
  modelName: string;
  versionName: string;
  baseModel: string;
}

/**
 * The resource types the PAGE resource picker (`useResourcePicker`) accepts in
 * v1: Checkpoint + LoRA only. Matches the page-LoRA body contract — a
 * Checkpoint pick goes into `body.modelVersionId`, a LoRA pick into
 * `body.additionalResources`. The host REJECTS any other requested type (the
 * native modal never opens). Widen here + on the host when the body schema
 * grows.
 */
export type BlockResourcePickerType = 'Checkpoint' | 'LORA';

/**
 * What the host returns from the PAGE resource picker
 * (`RESOURCE_PICKER_RESULT.selected`). DELIBERATELY narrow: only the fields a
 * block needs to build a generation body + dedupe/display — never the catalog,
 * a list, or any private / availability / early-access / NSFW internal. The
 * picker is DISCOVERY ONLY: `versionId` is re-validated server-side at
 * estimate/submit by the page gate + orchestrator belt, so nothing here is an
 * entitlement.
 *
 * Mirrors the host's `RESOURCE_PICKER_RESULT` projection in civitai/civitai's
 * `PageBlockHost.tsx`. Keep in lockstep.
 */
export interface BlockResourceInfo {
  /** ModelVersion id — the wire identifier `body.modelVersionId` /
   * `additionalResources[].modelVersionId` needs. */
  versionId: number;
  modelId: number;
  /** Public display name of the picked model — the user chose this resource,
   * so the host surfaces its name for the block to render (instead of `#id`).
   * Same source as `BlockCheckpointInfo.modelName`. */
  modelName: string;
  /** Public display name of the picked model version. Same source as
   * `BlockCheckpointInfo.versionName`. */
  versionName: string;
  /** The resource's base model (e.g. 'Flux.1 D', 'SDXL 1.0') so the block can
   * keep a LoRA pick in the checkpoint's family client-side. */
  baseModel: string;
  /** 'Checkpoint' | 'LORA' (the canonical model type the host resolved). */
  modelType: string;
  // --- Public recommended-settings projection (App Blocks Phase-2a PR-C) ---
  // The host WIDENED the `RESOURCE_PICKER_RESULT.selected` projection (and the
  // sibling `GET /api/v1/blocks/generation-resources` rehydrate endpoint) to also
  // carry the PUBLIC recommended settings a block needs to render a per-resource
  // weight slider + trigger words — nothing availability/entitlement-related. All
  // OPTIONAL + additive: a host predating PR-C omits them, and the values are
  // still DISCOVERY-ONLY hints (the server re-derives + re-prices at submit).
  // Mirrors civitai's `SafeGenerationResource` / `projectSafeGenerationResource`.
  /** Recommended default resource weight (the host defaults this to `1`). */
  strength?: number;
  /** Recommended min weight clamp (host default `-1`). */
  minStrength?: number;
  /** Recommended max weight clamp (host default `2`). */
  maxStrength?: number;
  /** Public trigger words (host default `[]`). */
  trainedWords?: string[];
  /** Public recommended CLIP-skip; `null` when the resource has none. */
  clipSkip?: number | null;
}

/**
 * A Civitai-hosted source image for an img2img generation. Mirrors civitai's
 * merged `blockTextToImageBodySchema.sourceImage` (`{ url, width, height }`).
 *
 * `url` MUST resolve to a Civitai-controlled host — the server rejects an
 * arbitrary remote URL (SSRF / arbitrary-fetch). An image obtained from
 * {@link BlockUploadedImageInfo.url} (via `useImageUpload`) satisfies this.
 * `width`/`height` are the intrinsic dimensions the graph uses for its
 * denoise/aspect derivation.
 */
export interface BlockSourceImage {
  url: string;
  width: number;
  height: number;
}

/**
 * The moderated image the host returns from `OPEN_IMAGE_UPLOAD`
 * (`IMAGE_UPLOAD_RESULT.selected`) — see {@link BlockUploadedImageInfo} usage in
 * `useImageUpload`. The platform's only guarantee is that the image is scanned
 * clean, within the SFW ceiling, and unflagged before its id crosses back into
 * the (untrusted) block.
 *
 * Mirrors the host's `BlockUploadedImageInfo` projection in civitai/civitai's
 * `src/components/AppBlocks/BlockImageUploadModal.tsx`. Keep in lockstep.
 * NOTE: `imageId` is a NUMBER (the `Image` row id), matching the host — not a
 * string. `contentRating` is the off-site rating ladder value (identical to
 * {@link ContentRating}).
 */
export interface BlockUploadedImageInfo {
  /** The moderated `Image` row id. */
  imageId: number;
  /** The scanner's resolved NSFW-level bitmask value. */
  nsfwLevel: number;
  /** Off-site content rating (`'g' | 'pg' | 'pg13' | 'r' | 'x'`). */
  contentRating: ContentRating;
  /** The Civitai-hosted image URL — usable directly as a {@link BlockSourceImage.url}. */
  url: string;
}

/**
 * Early-resolve handle for an ASYNC-SCAN `'display'` upload (`asyncScan: true`
 * on `OPEN_IMAGE_UPLOAD`). The image has been PERSISTED (its `imageId` is known)
 * but is NOT yet scanned — so it is AUTHOR-PREVIEW-ONLY until the verdict lands.
 * The host early-resolves the upload modal with this handle and streams the scan
 * verdict later via {@link BlockImageScanResult} on a host→block `IMAGE_SCAN_RESOLVED`.
 *
 * `status: 'pending'` is the on-wire DISCRIMINANT that tells the SDK hook this is
 * a pending handle rather than a moderated {@link BlockUploadedImageInfo} (a host
 * that predates async-scan returns the moderated shape directly — the hook treats
 * that as immediately-scanned; see the compat matrix in `useImageUpload`).
 *
 * SECURITY: a pending handle is NOT a moderation stamp. Its `imageId`/`url` are
 * the author's OWN just-uploaded image and are safe to preview to that author,
 * but MUST NOT be persisted to any cross-user surface until a `'scanned'` verdict
 * arrives — the server-side display gate remains authoritative and refuses to
 * serve an unscanned/blocked image to others.
 *
 * Mirrors the host's pending projection in civitai/civitai's
 * `BlockImageUploadModal.tsx` / `PageBlockHost.tsx`. Keep in lockstep.
 */
export interface BlockPendingImageInfo {
  /** On-wire discriminant vs the moderated {@link BlockUploadedImageInfo}. */
  status: 'pending';
  /** The persisted `Image` row id (NOT yet scan-cleared). */
  imageId: number;
  /**
   * Civitai-hosted edge URL of the author's OWN just-uploaded image (an
   * unguessable UUID key). AUTHOR-ONLY preview; NOT persisted to any cross-user
   * surface until the scan verdict is `'scanned'`.
   */
  url: string;
}

/**
 * Async scan verdict for a pending `'display'` upload, delivered host→block on
 * `IMAGE_SCAN_RESOLVED` (correlated to the originating `OPEN_IMAGE_UPLOAD` by its
 * `requestId` + the `imageId`). A discriminated union:
 *
 *  - `'scanned'` — the image cleared the pipeline: scanned clean, within the SFW
 *    ceiling, and unflagged. ONLY this verdict carries a usable moderated
 *    {@link BlockUploadedImageInfo} projection (the same shape the BLOCKING path
 *    returns). This is the only verdict on which a block may persist the image to
 *    a cross-user surface.
 *  - `'blocked'` — a TERMINAL non-clean outcome (scan verdict / over the NSFW
 *    ceiling / flagged / import-failed). Carries NO usable image — the block must
 *    NOT persist it. `reason` is an optional UI-renderable message.
 *  - `'error'` — a TRANSIENT / host-side error or poll-budget timeout. RETRYABLE
 *    (a network blip must NOT be mislabelled `'blocked'`); the block may re-call
 *    `scanStatus`. Carries NO usable image. `message` is an optional detail.
 *
 * Mirrors the host's `BlockImageScanPoller` verdict in civitai/civitai's
 * `PageBlockHost.tsx`. Keep in lockstep.
 */
export type BlockImageScanResult =
  | { status: 'scanned'; image: BlockUploadedImageInfo }
  | { status: 'blocked'; reason?: string }
  | { status: 'error'; message?: string };

/**
 * Upload MODE for `OPEN_IMAGE_UPLOAD` (via {@link useImageUpload}). Mirrors the
 * host's `BlockUploadPurpose` in civitai/civitai's `pageBlockHostLogic.ts`.
 *
 *  - `'display'` (DEFAULT — absent/unrecognized normalizes to this on the host,
 *    so an SDK that omits `purpose` stays byte-compatible): a PUBLIC image that
 *    routes through the session-authed scan pipeline (SFW + no-flag gate). The
 *    host returns a moderated {@link BlockUploadedImageInfo}.
 *  - `'generationSource'`: a PRIVATE generation INPUT (an img2img source image).
 *    UNSCANNED — the orchestrator scans it at generation time — so the host
 *    returns ONLY the source shape ({@link BlockGenerationSourceImageInfo}); no
 *    `imageId`/`nsfwLevel`/`contentRating` crosses back into the block.
 */
export type BlockUploadPurpose = 'display' | 'generationSource';

/**
 * The source-image result the host returns from `OPEN_IMAGE_UPLOAD` when the
 * block requested `purpose: 'generationSource'` (`IMAGE_UPLOAD_RESULT.selected`)
 * — an UNSCANNED private img2img input. Identical to {@link BlockSourceImage}
 * ({@link WorkflowBody.sourceImage}'s type): only `{ url, width, height }`, with
 * no `imageId`/`nsfwLevel`/`contentRating` (the image is scanned later, at
 * generation time, not before its handle crosses into the block). The `url` is a
 * Civitai-hosted host, so it feeds straight into a `WorkflowBody.sourceImage`.
 *
 * Mirrors the host's `BlockSourceImageInfo` in civitai/civitai's
 * `src/components/AppBlocks/BlockGenerationSourceUploadModal.tsx`. Keep in
 * lockstep.
 */
export type BlockGenerationSourceImageInfo = BlockSourceImage;

/**
 * One of the model version's curated preview images, with the standard
 * gen params extracted from its source meta. Block UIs use these to let
 * the user "remix" a known-good prompt without typing it.
 *
 * `null` on a gen-param field means the source image's meta didn't have
 * that value (or it was malformed). The block should treat null as "keep
 * the current value" rather than clearing the field — that way a partial
 * meta doesn't trash a prompt the user already typed.
 *
 * Mirrors `ShowcaseImage` in civitai/civitai's
 * `src/components/AppBlocks/types.ts`. Keep in lockstep.
 */
export interface ShowcaseImage {
  id: number;
  url: string;
  width: number;
  height: number;
  prompt: string | null;
  negativePrompt: string | null;
  cfgScale: number | null;
  steps: number | null;
  seed: number | null;
  sampler: string | null;
  /** Per-resource CLIP layer skip count (SD1/SDXL). Flux ignores it. */
  clipSkip: number | null;
}

/**
 * The shape the host delivers for the three model-page slots
 * (`model.sidebar_top`, `model.below_images`, `model.actions_extra`).
 *
 * Optional fields are present when the host has them: `viewerUserId` is
 * `null` for anonymous viewers, and `viewerUsername`/`viewerStatus`/`theme`
 * are only filled when a viewer is signed in or the host's theme is
 * resolved.
 *
 * Block authors using these slots should narrow:
 *
 *   const ctx = useBlockContext().context as ModelSlotContext;
 *
 * Mirrors `ModelSlotContext` in civitai/civitai. Keep in lockstep — adding
 * a field on either side without the other will silently degrade.
 */
export interface ModelSlotContext extends BlockContext {
  slotId: 'model.sidebar_top' | 'model.below_images' | 'model.actions_extra';
  modelId: number;
  modelVersionId: number;
  modelName: string;
  modelType: string;
  modelNsfwLevel: number;
  creatorUserId: number;
  viewerUserId: number | null;
  viewerNsfwEnabled: boolean;
  viewerUsername?: string | null;
  /** Coarse status surface; authoritative re-check is `/api/v1/blocks/me`. */
  viewerStatus?: 'active' | 'banned' | 'muted';
  /** Host-page color scheme; lets the iframe match without a flicker. */
  theme?: 'light' | 'dark';
  /**
   * Effective Checkpoint after publisher-default ∪ viewer-override merge.
   * `null` when no checkpoint is configured (publisher hasn't set one AND
   * the bound model isn't a Checkpoint itself) — block should render a
   * "missing checkpoint" state and prompt the user to ask the model owner.
   */
  checkpoint?: BlockCheckpointInfo | null;
  /**
   * Top showcase images for the bound model version, ordered by all-time
   * reactions. Capped at 6 by the host. Empty array means the version
   * has no preview images yet. The block uses these to render a "click
   * to remix" carousel that populates the form from the selected image's
   * gen meta.
   */
  showcaseImages?: ShowcaseImage[];
}

/**
 * Short-lived, block-scoped JWT minted by civitai.com for a single block
 * instance. Carries the scopes the user consented to plus an optional
 * Buzz spend budget the parent enforces on orchestrator calls.
 */
export interface BlockToken {
  raw: string;
  scopes: string[];
  expiresAt: Date;
  buzzBudget?: number;
}

/**
 * Settings the block sees: publisher-controlled (from manifest defaults +
 * any per-deployment overrides) and user-controlled (per-instance prefs).
 */
export interface BlockSettings {
  publisherSettings: Record<string, unknown>;
  userSettings: Record<string, unknown>;
}

/**
 * The signed-in viewer. `null` in `BlockInitPayload.viewer` means anonymous.
 *
 * `status` is OPTIONAL and a coarse surface — `/api/v1/blocks/me` is the
 * authoritative re-check if the block needs to gate on it. The platform omits
 * it from BLOCK_INIT to third-party iframes for privacy (civitai #2521), so
 * blocks must not assume it is present.
 *
 * Mirrors the inline viewer shape in `BlockInitPayload` on the platform
 * side (civitai/civitai `src/components/AppBlocks/types.ts`).
 */
export interface ViewerInfo {
  id: number;
  username: string | null;
  status?: 'active' | 'banned' | 'muted';
}

/**
 * Host-page color scheme. v2 will add a sibling `themeCssVars` field on
 * `BlockInitPayload` for design-token sharing; v1 ships the string only.
 */
export type Theme = 'light' | 'dark';

// ============================================================
// Workflow surface
// ============================================================

export type WorkflowStatus =
  | 'idle'
  | 'estimating'
  | 'confirming'
  | 'submitting'
  | 'polling'
  | 'done'
  | 'error';

/**
 * The Buzz currency pools a Civitai App may spend from / read a balance for.
 *
 * DELIBERATELY narrow — the domain-clamped set the Civitai Apps host honors:
 * `blue` (free/earned), `green` (creator-compensation pool), and `yellow`
 * (purchased). It intentionally omits the platform-internal pools (`red`,
 * `purple`, …) that appear in the broader `@civitai/app-sdk/oauth`
 * `BuzzAccountType` — a block can neither prefer nor read those. Keep this in
 * lockstep with civitai/civitai's block submit-body schema clamp.
 */
export type BuzzAccountType = 'blue' | 'green' | 'yellow';

/**
 * Generation parameters a block can override. All optional — the host fills
 * sensible defaults (sampler='Euler', steps=25, dimensions from the
 * base-model family) when omitted, so the simplest block can submit
 * `{ kind: 'textToImage', modelId, modelVersionId, params: { prompt } }`.
 *
 * Bounds mirror civitai/civitai's `blockWorkflowBodySchema` zod gate; over-
 * limit values are rejected server-side before reaching the orchestrator.
 */
export interface BlockTextToImageParams {
  prompt: string;
  negativePrompt?: string;
  /** Range 1–30. */
  cfgScale?: number;
  /** Sampler name (e.g. 'Euler', 'DPM++ 2M Karras'). Defaults to 'Euler'. */
  sampler?: string;
  /** Range 1–50. */
  steps?: number;
  /** `null` lets the orchestrator pick. */
  seed?: number | null;
  /** Range 64–2048. Defaults to 1024 for SDXL/Flux, 512 for SD1/SD2. */
  width?: number;
  /** Range 64–2048. Same defaults as width. */
  height?: number;
  /** Per-resource CLIP layer skip count (SD1/SDXL). Range 0–12. Flux ignores it. */
  clipSkip?: number;
  /** Range 1–4. Defaults to 1. */
  quantity?: number;
}

/**
 * The text-to-image member of the {@link WorkflowBody} discriminated union
 * (`kind: 'textToImage'`). This is the original, single-member shape — kept
 * byte-identical for backward compatibility. An existing
 * `{ kind: 'textToImage', modelId, modelVersionId, params }` body must
 * continue to satisfy {@link WorkflowBody} unchanged.
 *
 * Both `modelId` and `modelVersionId` are required even though they're
 * conceptually redundant — the host validates that `modelId` matches the
 * JWT's `ctx.modelId` (context binding) AND that the version belongs to
 * that model (DB lookup). The block always has both values from
 * `useBlockContext().context as ModelSlotContext`.
 */
export type WorkflowBodyTextToImage = {
  kind: 'textToImage';
  modelId: number;
  modelVersionId: number;
  /**
   * Optional additional generation resources (LoRAs) layered on top of the
   * checkpoint (`modelVersionId`). Mirrors civitai's `blockWorkflowBodySchema`:
   *  - max 5 entries
   *  - each: { modelVersionId: positive int, strength?: number in [-1, 2], default 1 }
   *  - the server is LoRA-only for additional resources (non-LoRA versions are
   *    rejected) and enforces base-model-family compatibility with the checkpoint
   *    + per-resource entitlement (early-access/Private) before any Buzz spend.
   * Omit for a checkpoint-only generation (backward compatible).
   */
  additionalResources?: Array<{ modelVersionId: number; strength?: number }>;
  /**
   * Optional img2img init/source image (App Blocks IMAGE bridge). When present,
   * the block bridge emits an `img2img` graph workflow instead of `txt2img`;
   * omit for a plain text-to-image generation (backward compatible). Constraints
   * (all SERVER-ENFORCED — mirrors civitai's merged `blockTextToImageBodySchema`):
   *  - `url` must be a Civitai-hosted https image (an uploaded image from
   *    {@link BlockUploadedImageInfo.url} qualifies) — never an arbitrary remote URL.
   *  - SD-family checkpoints ONLY (a non-SD-family checkpoint is rejected fail-closed).
   *  - PAGE apps only — the server rejects `sourceImage` on a model-bound token.
   */
  sourceImage?: BlockSourceImage;
  /**
   * Optional shared-storage key of the published content this generation runs on
   * behalf of. The server resolves it to the content's author for attribution
   * (see the G5 civitai PR). Opaque string — the block passes back the `key` it
   * got from `useSharedStorage()` for the content being generated against; omit
   * when not applicable.
   */
  sharedContentKey?: string;
  /**
   * Optional preferred Buzz pool to fund this generation from — a *preference*,
   * not a guarantee. The host clamps it server-side to what the viewer actually
   * holds and to the domain-allowed pools (a `blockWorkflowBodySchema` field on
   * civitai/civitai; preferred-first, then falls back). Omit for today's default
   * host-chosen funding order (backward compatible). Whichever pool ended up the
   * primary funder is echoed back on {@link BlockWorkflowSnapshot.spentAccountType}.
   */
  accountType?: BuzzAccountType;
  params: BlockTextToImageParams;
};

/**
 * The `customComfy` member of the {@link WorkflowBody} discriminated union
 * (`kind: 'customComfy'`) — runs a **server-registered, code-reviewed ComfyUI
 * recipe** end-to-end. This is a bounded, fail-closed primitive: the iframe
 * NEVER sends a Comfy graph. It sends only a registered `recipe` id plus a
 * small, per-recipe-validated `params` object; the civitai server owns the
 * entire graph (built by object construction, so the prompt is a leaf value
 * that cannot perturb graph topology).
 *
 * Trust / safety model (all SERVER-ENFORCED — mirrors civitai's forthcoming
 * `blockCustomComfyBodySchema`):
 *  - `recipe` is a **registered recipe id** resolved against a code-reviewed,
 *    in-repo recipe registry. An unknown id is **rejected server-side, fail-
 *    closed** (the schema enum is derived from the registry keys) — there is
 *    no way for a block to run an arbitrary/unreviewed graph.
 *  - `params` are **bounded and validated per-recipe** by the server's
 *    `.strict()` Zod param schema (extra fields rejected); each recipe pins
 *    its own resources (checkpoint/LoRA/diffusion AIRs) — the block cannot
 *    supply them.
 *
 * Billing is **post-paid** (the underlying orchestrator `customComfy` step
 * bills measured GPU runtime at a fixed rate, so there is NO exact pre-price):
 *  - `estimate` returns a per-recipe **display estimate**, not a firm quote —
 *    surface it as an estimate; the actual cost is known only on terminal.
 *  - Each recipe declares a hard per-job `maxBuzz` ceiling backed by an
 *    aggressive step `timeout`; the orchestrator physically caps the job at
 *    that ceiling server-side (worst-case Buzz = the timeout in seconds), and
 *    the host gates `maxBuzz <= token.buzzBudget` before submit. A single job
 *    therefore cannot exceed the recipe's declared ceiling no matter what.
 */
export type WorkflowBodyCustomComfy = {
  kind: 'customComfy';
  /**
   * A **registered recipe id** (e.g. `'seamless-pano-360'`). Resolved server-
   * side against the code-reviewed recipe registry; an unknown id is rejected
   * fail-closed. The recipe fixes the graph, the resource allowlist, the
   * checkpoint policy, and the `maxBuzz`/`timeout` budget ceiling — none of
   * which the block can influence beyond selecting the recipe + `params`.
   */
  recipe: string;
  /**
   * Bounded, per-recipe-validated parameters. Only the fields a recipe's
   * `.strict()` Zod schema accepts are honored; extra fields are rejected
   * server-side. The common shape:
   *  - `prompt` — the generation prompt (a leaf string; injected into the
   *    server-built graph by object construction, never string-templated).
   *  - `seed` — optional; `null`/omitted lets the orchestrator pick.
   *  - `engine` — optional recipe engine-variant selector (e.g. a DiT engine);
   *    the recipe defaults it when omitted.
   *  - `accountType` — optional preferred Buzz pool (a preference, clamped
   *    server-side to pools the viewer actually holds; see {@link BuzzAccountType}).
   */
  params: {
    prompt: string;
    seed?: number | null;
    engine?: string;
    accountType?: BuzzAccountType;
  };
};

/**
 * Body the block sends to `useBuzzWorkflow().{submit,estimate}`. A real
 * discriminated union keyed by `kind`:
 *  - {@link WorkflowBodyTextToImage} (`kind: 'textToImage'`) — the original
 *    checkpoint/LoRA/img2img generation body (unchanged, back-compatible).
 *  - {@link WorkflowBodyCustomComfy} (`kind: 'customComfy'`) — a bounded,
 *    server-registered ComfyUI recipe (post-paid; the iframe never sends a
 *    graph).
 *
 * New kinds extend this union as the host gains support for them. Narrow on
 * `body.kind` before touching member-specific fields (e.g. `modelId`/`params`
 * live only on the `textToImage` member).
 */
export type WorkflowBody = WorkflowBodyTextToImage | WorkflowBodyCustomComfy;

/**
 * The host-mediated view of an orchestrator workflow that an iframe block
 * receives over `postMessage`.
 *
 * This is intentionally a flattened **subset** of `WorkflowSnapshot` from
 * `../orchestrator/` — the host (civitai.com) maps the full orchestrator
 * payload down to this shape before forwarding. Notable differences:
 * - `workflowId` here = orchestrator's `id`
 * - `imageUrls` here = flattened from `steps[].output.images[].url`
 * - `cost.total` is the host-attested total (not the raw orchestrator field)
 * - the status union omits orchestrator-internal states like `unassigned`
 *
 * If the orchestrator gains a status the host doesn't recognize, the host
 * is responsible for mapping it to one of the values here (typically
 * `processing` or `failed`).
 */
export interface BlockWorkflowSnapshot {
  workflowId: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'canceled';
  cost?: { total: number };
  imageUrls?: string[];
  error?: string;
  /**
   * The Buzz pool that was the PRIMARY FUNDER of this generation — i.e. the
   * account with the LARGEST debit, which the host stamps onto the workflow
   * snapshot server-side. This is NOT necessarily "the paid account": a
   * generation covered mostly by free/earned Buzz reports `spentAccountType:
   * 'blue'`. Populated by the host from the Phase-1 backend `spentAccountType`
   * field; absent when the host predates it or no spend occurred. Informational
   * only — surface it (e.g. "funded from your yellow balance") but don't gate on it.
   */
  spentAccountType?: BuzzAccountType;
  /**
   * Set when the host opportunistically claimed a Buzz reward on the user's
   * behalf during submit. Currently the host only fires this for the daily
   * boost (25 blue Buzz, one per UTC day) when the user's balance would
   * otherwise have been short by less than the boost amount.
   *
   * Informational only — the block has no obligation to reconcile state
   * (the claim already settled in the orchestrator). A typical block UX
   * surfaces a small "+25 daily boost claimed" notice next to the
   * succeeded result.
   */
  autoClaim?: {
    type: 'dailyBoost';
    amount: number;
    accountType: 'yellow' | 'blue' | 'red' | 'green';
  };
}

// ============================================================
// Manifest
// ============================================================

/**
 * Which side of the settings split a field lives on.
 * - `publisher`: stored on `model_block_installs.settings` (or a publisher
 *   subscription row). The model owner / app installer controls it.
 * - `viewer`: stored on `block_user_settings.settings` (or a viewer
 *   subscription row). Each signed-in user controls their own value.
 */
export type SettingScope = 'publisher' | 'viewer';

/**
 * Widget hints the platform's generic SettingsForm renderer consumes.
 * `resource_picker` is the v0 escape hatch for the checkpoint case —
 * delegates to `useCheckpointPicker` (or a future generic picker hook)
 * via the host bridge.
 */
export type SettingWidget =
  | 'number'
  | 'slider'
  | 'resource_picker'
  | 'text'
  | 'textarea'
  | 'select'
  | 'toggle';

interface ManifestSettingFieldBase {
  scope: SettingScope;
  label: string;
  description: string;
  /**
   * Hide the field when this scope isn't in the app's declared scopes.
   * Lets a manifest carry a "Max Buzz per generation" field that only
   * renders for apps that requested `ai:write:budgeted`.
   */
  requires_scope?: string;
}

export interface ManifestNumberField extends ManifestSettingFieldBase {
  type: 'number';
  widget?: 'number' | 'slider' | 'resource_picker';
  default?: number | null;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Widget-specific config. For `resource_picker`:
   *   `{ resource_type: 'Checkpoint' | 'LORA' | ..., filter_by_ecosystem?: boolean }`.
   */
  widget_options?: Record<string, unknown>;
}

export interface ManifestStringField extends ManifestSettingFieldBase {
  type: 'string';
  widget?: 'text' | 'textarea' | 'select';
  default?: string | null;
  max_length?: number;
  /** RegExp source. Compiled at validate-time. */
  pattern?: string;
  /** Required when `widget === 'select'`. */
  enum?: string[];
}

export interface ManifestBooleanField extends ManifestSettingFieldBase {
  type: 'boolean';
  widget?: 'toggle';
  default?: boolean;
}

export type ManifestSettingField =
  | ManifestNumberField
  | ManifestStringField
  | ManifestBooleanField;

/**
 * W3 v0 manifest settings declaration. Keyed by snake_case field name.
 * Mirrors `manifestSettingsSchema` in civitai/civitai's
 * `src/server/schema/blocks/manifest-settings.meta.schema.ts`. Keep in
 * lockstep — adding a field type or widget on one side without the other
 * will silently degrade the form renderer or the platform validator.
 */
export type ManifestSettings = Record<string, ManifestSettingField>;

export type ContentRating = 'g' | 'pg' | 'pg13' | 'r' | 'x';

export interface ManifestTarget {
  slotId: string;
  priority: number;
  requiredContext?: string[];
}

export interface ManifestIframe {
  src: string;
  minHeight: number;
  /** Optional. Omit or set to `null` for no cap. */
  maxHeight?: number | null;
  resizable: boolean;
  sandbox: string;
}

export interface ManifestAsset {
  url: string;
  integrity: string;
}

export interface ManifestPreview {
  thumbnail: string;
  description: string;
  screenshots?: string[];
}

/**
 * v1 manifest shape. Mirrors `schemas/app-block/v1.json` — keep them in sync.
 *
 * The trailing `renderMode` / `assetBundle` / `trustTier` fields are
 * forward-compat hooks for v2 inline mode; they are accepted but unused
 * by the v1 iframe runtime.
 */
export interface BlockManifestV1 {
  $schema: 'https://civitai.com/schemas/app-block/v1.json';
  appId: string;
  blockId: string;
  version: string;
  name: string;
  type: 'block' | 'embed';
  targets: ManifestTarget[];
  scopes: string[];
  /**
   * Optional per-scope justification: a map of scope-id → free-text rationale
   * (WHY the app needs that permission), shown to the moderator during review.
   * Backward-compatible — omit it and the manifest stays valid; `scopes` is
   * unchanged. Every key MUST be a scope also present in `scopes`; each value is
   * a non-empty string of at most 500 chars. Captures the developer's STATED
   * rationale only — the platform does not verify the claims. Kept in lockstep
   * with the canonical schema's `scopeJustifications` (civitai #3195).
   */
  scopeJustifications?: Record<string, string>;
  iframe: ManifestIframe;
  assets?: ManifestAsset[];
  /**
   * Per-field settings declaration the platform validates user input
   * against AND renders the publisher/viewer settings UI from. v0 shape;
   * see {@link ManifestSettings}.
   */
  settings?: ManifestSettings;
  contentRating: ContentRating;
  /**
   * Optional marketplace category for the app's `/apps` store listing. When
   * present it flows to the listing automatically on moderator-approve (only
   * when a mod has not already curated one). Omit to let a moderator
   * categorise. One of {@link BlockCategory} — kept in lockstep with the
   * canonical schema's `category` enum and MARKETPLACE_CATEGORIES on the server.
   */
  category?: BlockCategory;
  preview?: ManifestPreview;
  promotionEligible?: boolean;
  minApiVersion: string;
  /**
   * Author-declared mode preference. `hybrid` is a manifest-only hint that
   * the host resolves to a concrete `iframe` | `inline` value before sending
   * `BLOCK_INIT` — that's why `BlockInitPayload.renderMode` is narrower.
   */
  renderMode?: 'iframe' | 'inline' | 'hybrid';
  assetBundle?: { url: string | null; sha256: string | null };
  trustTier?: 'unverified' | 'verified' | 'internal';
}

export type BlockManifest = BlockManifestV1;

// ============================================================
// Buzz self-read + wildcard-pack bridge result types
// ============================================================

/**
 * One buzz-transaction row as the host projects it for a block, on the wire in
 * `BUZZ_TRANSACTIONS_RESULT`.
 *
 * Mirrors civitai/civitai's `projectBlockBuzzTransaction`
 * (`src/server/services/blocks/block-buzz-read.projection.ts`) — keep in
 * lockstep. The host deliberately STRIPS the sensitive fields the raw ledger
 * carries: `details` is allowlisted to the entity-attribution keys (the
 * passthrough — incl. `stripePaymentIntentId` — is dropped), and
 * `externalTransactionId` is nulled by the host on EVERY block-facing row
 * (default-deny; civitai/civitai #3192) — the field stays on the wire for
 * shape-compat but is always `null` for blocks.
 *
 * DATE WIRE CAVEAT: `date` is documented as ISO-8601 to match the SDK's
 * wire convention, BUT the host currently forwards the raw tRPC `result` over a
 * structured-clone `postMessage` (it does NOT `.toISOString()`-map it the way
 * the `SHARED_LIST` bridge does), so at runtime `date` arrives as a `Date`
 * INSTANCE. The block-side guard + `useBuzzTransactions` hook tolerate BOTH a
 * `Date` and an ISO string (rehydrating to `Date`), so either representation
 * round-trips correctly. See `civitai-blocks-react`'s `isValidBuzzTransactionsResult`.
 */
export interface BlockBuzzTransaction {
  /** ISO-8601 on the wire (a `Date` instance at runtime today — see the caveat above). */
  date: string;
  /** The `TransactionType` enum NAME (e.g. `'Tip'`, `'Purchase'`), never the numeric value. */
  type: string;
  amount: number;
  fromAccountId: number;
  toAccountId: number;
  /** Buzz pool name (e.g. `'yellow'`, `'blue'`, `'cashSettled'`). */
  fromAccountType: string;
  toAccountType: string;
  description?: string | null;
  /**
   * Entity-attribution fields ONLY — the host allowlists these five keys and
   * drops every passthrough key (incl. `stripePaymentIntentId`).
   */
  details?: {
    user?: string;
    entityId?: number;
    entityType?: string;
    url?: string;
    toAccountType?: string;
  } | null;
  /** Always `null` for blocks — the host nulls it on every row (default-deny; #3192). Present for wire-compat. */
  externalTransactionId: string | null;
  fromUser?: { id: number; username: string | null };
  toUser?: { id: number; username: string | null };
}

/**
 * One all-pool balance row on the wire in `BUZZ_ACCOUNTS_RESULT`. Mirrors
 * civitai/civitai's `blocks.getMyBuzzAccounts` projection (`{ accountType,
 * balance }` for each pool in `blockBuzzAccountTypes` — the three spendable pools
 * PLUS the creator payout pools) — keep in lockstep.
 */
export interface BlockBuzzAccount {
  /** Buzz pool name — a spendable pool or a creator payout pool. */
  accountType: string;
  balance: number;
}

/**
 * One model-version's generation-compensation row for the month containing the
 * requested `date`, on the wire in `DAILY_COMPENSATION_RESULT`. Mirrors
 * civitai/civitai's `getDailyCompensationRewardByUser`
 * (`src/server/services/buzz.service.ts`) — keep in lockstep. `data` totals are
 * Buzz; `cashData` totals are in pennies (`cashCents` is their sum). The
 * per-day `createdAt` is a `YYYY-MM-DD` day-string (NOT a full ISO timestamp),
 * so — unlike a transaction's `date` — it is NOT rehydrated to a `Date`.
 */
export interface BlockDailyCompensationResource {
  id: number;
  name: string;
  modelName: string;
  /** Per-day Buzz totals; `createdAt` is a `YYYY-MM-DD` day-string. */
  data: Array<{ createdAt: string; total: number }>;
  /** Per-day cash totals in pennies; `createdAt` is a `YYYY-MM-DD` day-string. */
  cashData: Array<{ createdAt: string; total: number }>;
  totalSum: number;
  cashCents: number;
}

/**
 * The signed-in viewer as the host projects it for a block on the wire in
 * `VIEWER_RESULT` (the host-mediated `GET_VIEWER` self-read).
 *
 * Mirrors civitai/civitai's `blocks.getMyViewer` projection
 * (`src/server/routers/blocks.router.ts`, PR #3152) — keep in lockstep. Distinct
 * from the BLOCK_INIT-embedded {@link ViewerInfo}: `status` is the narrow
 * spendable/mutable pair (`'active' | 'muted'` — a `banned` viewer can't read at
 * all, so the read fails rather than returning `status: 'banned'`). The read is
 * token-bound: only a signed-in viewer resolves; an anonymous / banned token
 * comes back as the `VIEWER_RESULT` free-text `error` instead.
 *
 * NULLABILITY: both `username` and `buzzBudget` are present-but-NULLABLE, not
 * omitted. The host returns `username: null` for a viewer with no handle and
 * `buzzBudget: null` when the block token lacks the budget claim — the fields are
 * always present on a success reply. Consumers (and the trust-boundary guard)
 * MUST accept `null` for both; the block handles the null case.
 */
export interface BlockViewer {
  id: number;
  username: string | null;
  status: 'active' | 'muted';
  /** The viewer's current Buzz budget, or `null` when the token lacks the claim. */
  buzzBudget: number | null;
}

/**
 * The DISCRIMINATED error enum a `WILDCARD_PACK_RESULT` carries on failure —
 * mirror civitai/civitai's `WildcardPackErrorCode`
 * (`src/components/AppBlocks/wildcardPackParse.ts`) EXACTLY. Unlike the buzz
 * bridges' free-text `error`, the wildcard bridge's error is one of these five
 * codes: `not-found`/`forbidden` (the resolve proc's gates), `too-large` (the
 * pre-download or inflation cap), `parse-failed` (fetch/unzip/parse/abort), and
 * `busy` (host-side per-tab concurrency backpressure — the block should retry).
 */
export type BlockWildcardPackErrorCode =
  | 'not-found'
  | 'forbidden'
  | 'too-large'
  | 'parse-failed'
  | 'busy';

/**
 * A parsed wildcard pack the host resolves + fetches + unzips + parses AS THE
 * USER and returns on `WILDCARD_PACK_RESULT`. Mirrors civitai/civitai's
 * `ResolveWildcardPackResult` `meta` + `maturity` spread with the parsed prompt
 * lists (`src/server/services/wildcard-pack.service.ts` +
 * `src/components/AppBlocks/PageBlockHost.tsx`) — keep in lockstep. `lists` maps
 * each list name (`clothing/tops`) to its options; `truncated`/`truncatedLists`
 * flag caps that were hit (anti-zip-bomb / result caps); `maturity` is the
 * viewer's authoritative ceiling.
 */
export interface BlockWildcardPack {
  modelId: number;
  modelVersionId: number;
  modelName: string;
  versionName: string;
  creatorUsername: string | null;
  /** List name → its options (e.g. `{ 'clothing/tops': ['tee', 'hoodie'] }`). */
  lists: Record<string, string[]>;
  /** True when ANY cap (entries / bytes / options / chars / yaml traversal) was hit. */
  truncated: boolean;
  /** The names of the lists whose OWN options were capped/char-truncated. */
  truncatedLists: string[];
  maturity: {
    /** The viewer's authoritative browsing-level ceiling (flag bitmask). */
    browsingLevel: number;
    /** True when that ceiling permits no mature content. */
    sfwOnly: boolean;
  };
}

// ============================================================
// App generator SUBQUEUE (QUERY_APP_WORKFLOWS / CANCEL_APP_WORKFLOW)
// ============================================================

/**
 * One result image on an {@link AppWorkflow}. Mirrors civitai/civitai's
 * `AppWorkflowImage` projection (`src/server/services/blocks/workflow.service.ts`,
 * PR #3164) — keep in lockstep. Only `available` blobs with a non-null url are
 * surfaced by the host (pending/blocked blobs are dropped rather than handing the
 * block dead links). `width`/`height` are `null` until the orchestrator populates
 * them; `nsfwLevel` is the numeric civitai browsing-level bitflag (1/2/4/8/16),
 * `null` for an unrated blob.
 */
export interface AppWorkflowImage {
  url: string;
  width: number | null;
  height: number | null;
  nsfwLevel: number | null;
}

/**
 * The clean, wire-stable projection of ONE orchestrator workflow in the calling
 * app's own generator SUBQUEUE — what `QUERY_APP_WORKFLOWS` / `CANCEL_APP_WORKFLOW`
 * return. Mirrors civitai/civitai's `AppWorkflow` / `projectAppWorkflow`
 * (`src/server/services/blocks/workflow.service.ts`, PR #3164) EXACTLY — KEEP IN
 * LOCKSTEP; a drift here silently strands the reply's transport validator.
 *
 * The host deliberately DROPS every internal/sensitive workflow field (steps,
 * params, prompts, resources, tokens, transactions, metadata, tags) so a block
 * can never read generation internals of a queue it only owns by tag.
 *
 *   status:    the block-contract status — the orchestrator's
 *              `unassigned`/`preparing`/`scheduled` all collapse to `pending`.
 *   images:    only `available` blobs with a non-null url (see {@link AppWorkflowImage}).
 *   cost:      the workflow's realized/estimated buzz total, or `null` when absent.
 *   createdAt: ISO-8601 string.
 */
export interface AppWorkflow {
  workflowId: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'canceled';
  images: AppWorkflowImage[];
  cost: number | null;
  /** ISO-8601. */
  createdAt: string;
}

// ============================================================
// Gated per-viewer image read (GET_IMAGES_BY_IDS / IMAGES_RESULT)
// ============================================================

/**
 * Per-viewer gated projection of ONE image returned by `GET_IMAGES_BY_IDS`
 * (`IMAGES_RESULT`). The host applies the REQUESTING VIEWER's browsing-level
 * clamp server-side, so the shape a viewer receives depends on THEIR ceiling:
 *
 *  - `status: 'visible'` — the image is scanned clean, within this viewer's
 *    browsing ceiling, and unflagged: the full moderated projection
 *    (`nsfwLevel`/`contentRating`/`url`, plus `width`/`height` for grid layout).
 *  - `status: 'hidden'` — the image EXISTS but is withheld from THIS viewer
 *    (above their browsing ceiling, not-yet-scanned, or flagged). NO `url` is
 *    ever returned — the block renders a blurred/placeholder cell. This is the
 *    load-bearing cross-user moderation boundary: an unclamped edge URL never
 *    crosses to a viewer who can't see the image.
 *
 * Image ids the host cannot resolve to a benchmark-eligible bare Image row are
 * OMITTED from the result entirely (neither visible nor hidden).
 *
 * Mirrors civitai/civitai's gated-read projection in
 * `src/server/services/blocks/*` — keep in lockstep.
 */
export type BlockGatedImage =
  | {
      imageId: number;
      status: 'visible';
      /** Scanner-resolved NSFW-level bitmask value. */
      nsfwLevel: number;
      /** Off-site content rating (`'g'|'pg'|'pg13'|'r'|'x'`). */
      contentRating: ContentRating;
      /** Civitai-hosted image URL (only present for a viewer allowed to see it). */
      url: string;
      width: number | null;
      height: number | null;
    }
  | {
      imageId: number;
      status: 'hidden';
    };
