/**
 * Public type surface for the `@civitai/app-sdk/blocks` subpath.
 *
 * Framework-agnostic. Hooks and transport classes that consume these types
 * live in a separate package so this module stays usable from any runtime.
 */

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
 * `status` is a coarse surface for the iframe — `/api/v1/blocks/me` is the
 * authoritative re-check if the block needs to gate on it.
 *
 * Mirrors the inline viewer shape in `BlockInitPayload` on the platform
 * side (civitai/civitai `src/components/AppBlocks/types.ts`).
 */
export interface ViewerInfo {
  id: number;
  username: string | null;
  status: 'active' | 'banned' | 'muted';
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
 * Body the block sends to `useBuzzWorkflow().{submit,estimate}`. A
 * discriminated union keyed by `kind` — v1 ships text-to-image only;
 * new kinds (e.g. img2img, video) extend this union as the host gains
 * support for them.
 *
 * Both `modelId` and `modelVersionId` are required even though they're
 * conceptually redundant — the host validates that `modelId` matches the
 * JWT's `ctx.modelId` (context binding) AND that the version belongs to
 * that model (DB lookup). The block always has both values from
 * `useBlockContext().context as ModelSlotContext`.
 */
export type WorkflowBody = {
  kind: 'textToImage';
  modelId: number;
  modelVersionId: number;
  params: BlockTextToImageParams;
};

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

export type SettingType = 'string' | 'number' | 'boolean' | 'select';

export interface SettingDefinition {
  id: string;
  type: SettingType;
  label: string;
  default?: unknown;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  required?: boolean;
}

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
  iframe: ManifestIframe;
  assets?: ManifestAsset[];
  settings?: SettingDefinition[];
  contentRating: ContentRating;
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
