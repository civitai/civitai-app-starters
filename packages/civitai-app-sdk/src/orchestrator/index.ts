/**
 * Orchestrator glue — types, constants, and fetch-based helpers shared by every
 * starter's BFF. Client + server safe: no Node-only imports, no `process.env`
 * access. All configuration flows through the `OrchestratorClient` value that
 * the caller builds.
 *
 * The orchestrator is a workflow API: you POST a `{ steps: [...] }` body with
 * one or more typed steps (`textToImage`, `imageGen`, `videoGen`, `comfy`, ...)
 * and get back a workflow snapshot. {@link WORKFLOW_STEP_TYPES} is the catalog
 * of available step types — start there to find the one you need, then either
 * use the matching `build*Body` helper or hand-craft a body and pass it to
 * {@link submitWorkflow} / {@link callOrchestrator}.
 *
 * Full OpenAPI spec: https://orchestration.civitai.com/openapi/v2-consumers.json
 */

// ---------- Constants -------------------------------------------------------

export const DEFAULT_ORCHESTRATOR_BASE_URL = 'https://orchestration.civitai.com';

/** Default SDXL base model. Replace per starter / per call as needed. */
export const DEFAULT_MODEL_AIR = 'urn:air:sdxl:checkpoint:civitai:101055@128078';

/**
 * Terminal orchestrator statuses (lowercase — matches what the API returns).
 */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'expired', 'canceled'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

// ---------- Step type catalog ----------------------------------------------

/**
 * Every workflow step type the orchestrator accepts, with a one-line
 * description. Use this as a map: find the step `$type` you want, then look
 * at the matching `build*Body` helper (if one exists) or fall back to
 * {@link callOrchestrator} with a hand-crafted body.
 *
 * Source of truth is `https://orchestration.civitai.com/openapi/v2-consumers.json`.
 * If a step type is missing here, the catalog is stale — open a PR.
 */
export const WORKFLOW_STEP_TYPES = {
  // ----- Image gen ---------------------------------------------------------
  /** Diffusion image gen (SDXL / Flux.1 / Pony / Illustrious / SD1.5 / etc.). Use {@link buildTextToImageBody}. */
  textToImage: 'Text-to-image via diffusion checkpoints (AIR URN models)',
  /**
   * Closed-source image-gen APIs (Nano Banana, Gemini, Flux.1 Kontext, Flux.2,
   * GPT-Image, Seedream, Grok, fal, …). Each engine has its own input shape;
   * see {@link IMAGE_GEN_ENGINES}. Use {@link buildImageGenBody}.
   */
  imageGen: 'Closed-source image gen (Nano Banana, Gemini, GPT-Image, Flux Kontext, Seedream, Grok, fal, …)',
  /** Arbitrary ComfyUI workflow graphs. Pass a `prompt` object (node graph). */
  comfy: 'Custom ComfyUI node-graph workflows',
  /** Upscale an existing image. Input is a source image URL + scale factor. */
  imageUpscaler: 'Image upscaling',
  /** LoRA / DoRA / embedding training. Long-running. */
  imageResourceTraining: 'Train a LoRA / DoRA / embedding from a dataset',
  /** Pre-process an image (resize, ControlNet preprocessor, etc.). */
  preprocessImage: 'Image preprocessing (resize, ControlNet preprocessors, …)',
  /** Format conversion between png/jpeg/webp/avif. */
  convertImage: 'Image format conversion',
  /** Upload arbitrary blob bytes for use as a reference in a later step. */
  imageUpload: 'Upload an image blob to use as input in a later step',

  // ----- Video gen ---------------------------------------------------------
  /** Video gen across all engines (VEO 3, Kling, Wan, Vidu, Sora, LTX, …). */
  videoGen: 'Video generation across all engines (VEO 3, Kling, Wan, Vidu, Sora, LTX, …)',
  /** Upscale an existing video. */
  videoUpscaler: 'Video upscaling',
  /** Frame interpolation / smoothing. */
  videoInterpolation: 'Video frame interpolation',
  /** Per-frame transformations (denoise, color correct, etc.). */
  videoEnhancement: 'Per-frame video enhancement',
  /** Extract individual frames from a video. */
  videoFrameExtraction: 'Extract frames from a video',
  /** Read video metadata (duration, codec, dimensions). */
  videoMetadata: 'Read video file metadata',
  /** Transcode video format / codec. */
  transcode: 'Audio/video transcoding',

  // ----- Audio -------------------------------------------------------------
  /** Text-to-speech (multi-voice, multi-language). */
  textToSpeech: 'Text-to-speech synthesis',
  /** Music generation via ACE Step 1.5 (lyrics + style → song). */
  aceStepAudio: 'Music generation (ACE Step 1.5)',
  /** Speech-to-text transcription. */
  transcription: 'Speech-to-text transcription',
  /** Mix multiple audio tracks. */
  audioMix: 'Audio track mixing',
  /** Generate captions from audio. */
  audioCaptioning: 'Caption generation from audio',

  // ----- Classification / tagging / moderation ----------------------------
  /** Hash an image / video / model for dedup or lookup. */
  mediaHash: 'Media content hashing',
  /** Hash a model file. */
  modelHash: 'Model file hashing',
  /** Rate media on aesthetic / quality axes. */
  mediaRating: 'Media aesthetic / quality rating',
  /** Caption an image with a vision model. */
  mediaCaptioning: 'Image captioning via vision models',
  /** WD-14 tagger (anime / booru tags). */
  wdTagging: 'WD-14 anime tagging',
  /** Estimate an age range for faces in an image. */
  ageClassification: 'Age range classification',
  /** xGuard NSFW / safety moderation. */
  xGuardModeration: 'NSFW / safety moderation',
  /** ClamAV scan a model file for malware. */
  modelClamScan: 'Antivirus scan a model file',
  /** Pickle-scan a model file for unsafe pickles. */
  modelPickleScan: 'Pickle-safety scan for model files',
  /** Parse model file metadata (SafeTensors / GGUF headers). */
  modelParseMetadata: 'Parse model file metadata',

  // ----- LLM ---------------------------------------------------------------
  /** Chat completion (OpenAI / Anthropic / Gemini / local OSS). */
  chatCompletion: 'LLM chat completion',
  /** Generate a richer prompt from a short seed prompt. */
  promptEnhancement: 'Prompt expansion via LLM',

  // ----- Utility -----------------------------------------------------------
  /** Echo the input back. Useful for testing the round-trip. */
  echo: 'Echo step — round-trip the input for testing',
  /** Package multiple blobs into a zip archive. */
  blobArchive: 'Zip multiple blobs into an archive',
} as const;

export type WorkflowStepType = keyof typeof WORKFLOW_STEP_TYPES;

/**
 * Engines that the `imageGen` step accepts. Each one has its own input shape;
 * the body's `engine` field selects which shape applies.
 *
 * Pair with {@link buildImageGenBody} or hand-craft via {@link callOrchestrator}.
 */
export const IMAGE_GEN_ENGINES = {
  /** Nano Banana 2 / Nano Banana Pro / Imagen 4. */
  google: 'Google (Nano Banana, Imagen)',
  /** Gemini 2.5 Flash image gen + editing. */
  gemini: 'Gemini',
  /** GPT-Image-1 / GPT-Image-1.5 / DALL-E-3. */
  openai: 'OpenAI (GPT-Image, DALL-E)',
  /** Flux.1 Kontext (pro/max/dev) — image editing with ref images. */
  'flux1-kontext': 'Flux.1 Kontext (image editing)',
  /** Flux.2 family (pro/max/dev/flex/klein). */
  flux2: 'Flux.2',
  /** Seedream (ByteDance) — 2K/4K image gen. */
  seedream: 'Seedream',
  /** Grok image generation. */
  grok: 'Grok',
  /** Wan image generation. */
  wan: 'Wan',
  /** Self-hosted SDCpp (stable-diffusion.cpp) gen. */
  sdcpp: 'SDCpp (self-hosted diffusion)',
  /** fal.ai routed gen. */
  fal: 'fal.ai',
  /** Comfy graph as an imageGen step (vs. the top-level `comfy` step). */
  comfy: 'Comfy (engine-style)',
} as const;

export type ImageGenEngine = keyof typeof IMAGE_GEN_ENGINES;

// ---------- Types -----------------------------------------------------------

/**
 * Orchestrator workflow status. Lowercase — matches what the orchestrator
 * actually returns. Forward-compat: open-ended string union so unknown
 * statuses don't break typing.
 */
export type WorkflowStatus =
  | 'unassigned'
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'canceled'
  | (string & {});

export interface GenerateInput {
  prompt: string;
  negativePrompt?: string;
  /** AIR URN, e.g. `urn:air:sdxl:checkpoint:civitai:101055@128078`. */
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  quantity?: number;
}

export interface WorkflowSnapshot {
  id: string;
  status: WorkflowStatus;
  cost?: { total?: number };
  steps?: Array<{
    output?: {
      /** Canonical image array. Each item has `url` + `available: boolean`. */
      images?: Array<{ url?: string; available?: boolean }>;
      /** Legacy/alternative — some workflow types still emit `blobs[]`. */
      blobs?: Array<{ url?: string; type?: string; mimeType?: string }>;
    };
  }>;
  [key: string]: unknown;
}

/**
 * Minimal orchestrator client config — just the base URL and the user's
 * access token. Build one with {@link createOrchestratorClient} and pass it
 * to the per-call helpers below.
 */
export interface OrchestratorClient {
  baseUrl: string;
  accessToken: string;
  logger?: OrchestratorLogger | null;
}

export interface OrchestratorLogger {
  error: (...args: unknown[]) => void;
}

export class OrchestratorError extends Error {
  override readonly name = 'OrchestratorError';
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

// ---------- Client factory --------------------------------------------------

export interface CreateOrchestratorClientOptions {
  /** OAuth access token (or personal API key — same Bearer scheme). */
  accessToken: string;
  /** Orchestrator base URL. Defaults to Civitai's prod orchestrator. */
  baseUrl?: string;
  /** Optional logger for SDK diagnostics. Defaults to console; set null to silence. */
  logger?: OrchestratorLogger | null;
}

export function createOrchestratorClient(
  opts: CreateOrchestratorClientOptions,
): OrchestratorClient {
  const client: OrchestratorClient = {
    baseUrl: opts.baseUrl ?? DEFAULT_ORCHESTRATOR_BASE_URL,
    accessToken: opts.accessToken,
  };
  if (opts.logger !== undefined) client.logger = opts.logger;
  return client;
}

// ---------- Raw HTTP --------------------------------------------------------

/**
 * Internal raw-fetch helper. Logs the failing response to the configured logger
 * and throws {@link OrchestratorError} on non-2xx. Exported so callers can
 * build their own orchestrator routes without duplicating this code.
 */
export async function callOrchestrator(
  client: OrchestratorClient,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { headers, ...rest } = init;
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${client.accessToken}`,
      ...headers,
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const logger = client.logger === undefined ? console : client.logger;
    logger?.error(
      `[orchestrator] ${init.method ?? 'GET'} ${path} -> ${res.status} ${res.statusText}\n` +
        `  raw body: ${text.length ? text.slice(0, 500) : '(empty)'}`,
    );
    throw new OrchestratorError(`HTTP ${res.status}`, res.status, body);
  }
  return body;
}

// ---------- Workflow body builder ------------------------------------------

export interface BuildTextToImageBodyOptions {
  /** Optional workflow tags — useful for attribution / debugging. */
  tags?: string[];
}

/**
 * Build a `textToImage` workflow body from a {@link GenerateInput}. Mirrors
 * the shape every starter's existing `buildWorkflowBody` produced.
 */
export function buildTextToImageBody(
  input: GenerateInput,
  opts: BuildTextToImageBodyOptions = {},
): unknown {
  const body: { tags?: string[]; steps: unknown[] } = {
    steps: [
      {
        $type: 'textToImage' as const,
        name: 'step_0',
        timeout: '00:10:00',
        input: {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          model: input.model ?? DEFAULT_MODEL_AIR,
          width: input.width ?? 1024,
          height: input.height ?? 1024,
          steps: input.steps ?? 25,
          cfgScale: input.cfgScale ?? 5,
          seed: input.seed,
          quantity: input.quantity ?? 1,
        },
      },
    ],
  };
  if (opts.tags && opts.tags.length > 0) body.tags = opts.tags;
  return body;
}

// ---------- imageGen body builder ------------------------------------------

/**
 * Input for an `imageGen` step. The engine + model pair picks which
 * sub-schema applies. Every closed-source image-gen API plugs in here:
 *
 *  - `{ engine: 'google', model: 'nano-banana-2' | 'nano-banana-pro' | 'imagen4', images?: string[] }`
 *  - `{ engine: 'gemini', model: '2.5-flash', operation: 'createImage' | 'editImage', images?: string[] }`
 *  - `{ engine: 'flux1-kontext', model: 'pro' | 'max' | 'dev', images?: string[] }`
 *  - `{ engine: 'flux2', model: 'pro' | 'max' | 'dev' | 'flex' | 'klein' }`
 *  - `{ engine: 'openai', model: 'gpt-image-1' | 'gpt-image-1.5' | 'dall-e-3' | 'dall-e-2' }`
 *  - `{ engine: 'seedream', model: '4b' | '20b' | 'v1.0' }`
 *  - `{ engine: 'grok', model: 'createImage' | 'editImage' }`
 *  - `{ engine: 'fal' | 'wan' | 'sdcpp' | 'comfy', model: ..., ... }`
 *
 * Reference images go in `images: [...]` (URL, data URL, or base64 string).
 * For aspect ratio / dimensions / seed / etc., pass the engine-specific
 * input fields directly — this builder is intentionally pass-through.
 *
 * See `https://orchestration.civitai.com/openapi/v2-consumers.json` for the
 * complete per-engine schema. The shape is forward-compat: any field the
 * engine accepts can be added to `input` without changing this SDK.
 */
export interface ImageGenInput {
  engine: ImageGenEngine | (string & {});
  model: string;
  prompt?: string;
  /** Reference images. Each item is a URL, data URL, or raw base64 string. */
  images?: string[];
  /** Catch-all for engine-specific fields. */
  [field: string]: unknown;
}

export interface BuildImageGenBodyOptions {
  tags?: string[];
  /** Step name. Defaults to `step_0`. */
  name?: string;
  /** Step timeout. Defaults to `'00:10:00'`. */
  timeout?: string;
}

/**
 * Build an `imageGen` workflow body. Pass-through for engine-specific input
 * fields — see {@link ImageGenInput} for examples per engine.
 *
 * @example  Nano Banana 2 with a reference image
 * ```ts
 * const body = buildImageGenBody({
 *   engine: 'google',
 *   model: 'nano-banana-2',
 *   prompt: 'turn this into a cartoon sticker',
 *   images: ['data:image/png;base64,...'],
 *   aspectRatio: '1:1',
 *   numImages: 1,
 *   resolution: '1K',
 * }, { tags: ['my-app'] });
 *
 * const estimate = await estimateWorkflow(client, body);
 * const submitted = await submitWorkflow(client, body);
 * ```
 *
 * @example  Flux.1 Kontext for image editing
 * ```ts
 * const body = buildImageGenBody({
 *   engine: 'flux1-kontext',
 *   model: 'pro',
 *   prompt: 'add sunglasses',
 *   images: ['https://example.com/portrait.jpg'],
 *   aspectRatio: '1:1',
 * });
 * ```
 */
export function buildImageGenBody(
  input: ImageGenInput,
  opts: BuildImageGenBodyOptions = {},
): unknown {
  const body: { tags?: string[]; steps: unknown[] } = {
    steps: [
      {
        $type: 'imageGen' as const,
        name: opts.name ?? 'step_0',
        timeout: opts.timeout ?? '00:10:00',
        input,
      },
    ],
  };
  if (opts.tags && opts.tags.length > 0) body.tags = opts.tags;
  return body;
}

// ---------- Generic single-step body builder -------------------------------

export interface BuildWorkflowBodyStep {
  $type: WorkflowStepType | (string & {});
  /** Step name. Defaults to `step_0`. */
  name?: string;
  /** Step timeout. Defaults to `'00:10:00'`. */
  timeout?: string;
  /** The step's input — shape is per-step-type. See {@link WORKFLOW_STEP_TYPES}. */
  input: unknown;
  /** Optional metadata attached to the step. */
  metadata?: Record<string, unknown>;
}

export interface BuildWorkflowBodyOptions {
  tags?: string[];
}

/**
 * Lowest-level body builder — drops a single step into the `{ steps: [...] }`
 * envelope and fills in `name` / `timeout` defaults. Use this when no dedicated
 * `build*Body` exists for your step type.
 *
 * For multi-step workflows, hand-build `{ tags?, steps: [step1, step2, ...] }`
 * yourself — there's no special envelope work beyond a JSON array.
 *
 * @example  videoGen via VEO 3
 * ```ts
 * const body = buildWorkflowBody({
 *   $type: 'videoGen',
 *   input: { engine: 'veo3', prompt: 'a fox jumping', duration: 8 },
 * }, { tags: ['my-app'] });
 * ```
 */
export function buildWorkflowBody(
  step: BuildWorkflowBodyStep,
  opts: BuildWorkflowBodyOptions = {},
): unknown {
  const body: { tags?: string[]; steps: unknown[] } = {
    steps: [
      {
        $type: step.$type,
        name: step.name ?? 'step_0',
        timeout: step.timeout ?? '00:10:00',
        input: step.input,
        ...(step.metadata ? { metadata: step.metadata } : {}),
      },
    ],
  };
  if (opts.tags && opts.tags.length > 0) body.tags = opts.tags;
  return body;
}

// ---------- Workflow endpoints ---------------------------------------------

/**
 * Cost preview ("what if") — runs the workflow validation/pricing pipeline
 * without committing any Buzz.
 */
export function estimateWorkflow(
  client: OrchestratorClient,
  body: unknown,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(client, '/v2/consumer/workflows?whatif=true', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<WorkflowSnapshot>;
}

/** Submit a workflow for real execution. Debits the token-owner's Buzz. */
export function submitWorkflow(
  client: OrchestratorClient,
  body: unknown,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(client, '/v2/consumer/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<WorkflowSnapshot>;
}

export function getWorkflow(
  client: OrchestratorClient,
  workflowId: string,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(
    client,
    `/v2/consumer/workflows/${encodeURIComponent(workflowId)}`,
    { method: 'GET' },
  ) as Promise<WorkflowSnapshot>;
}

// ---------- Polling ---------------------------------------------------------

export interface PollWorkflowOptions {
  /** Polling interval in ms. Default 1000. */
  intervalMs?: number;
  /** Max total time to poll in ms. Default 30000. */
  timeoutMs?: number;
  /** Optional abort signal — checked between ticks. */
  signal?: AbortSignal;
}

/**
 * Server-side long-poll helper. Re-fetches the workflow every `intervalMs`
 * until it reaches a terminal status, the timeout elapses, or the signal
 * aborts. Returns the latest snapshot regardless of which condition tripped —
 * callers inspect {@link isTerminal} on the result to decide what to do.
 */
export async function pollWorkflow(
  client: OrchestratorClient,
  workflowId: string,
  opts: PollWorkflowOptions = {},
): Promise<WorkflowSnapshot> {
  const interval = opts.intervalMs ?? 1000;
  const timeout = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeout;

  let snapshot = await getWorkflow(client, workflowId);
  while (!isTerminal(snapshot) && Date.now() + interval <= deadline) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, interval));
    snapshot = await getWorkflow(client, workflowId);
  }
  return snapshot;
}

// ---------- Snapshot inspection --------------------------------------------

export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

/** Pull every available image URL out of a workflow snapshot. */
export function extractImageUrls(snap: WorkflowSnapshot | null | undefined): string[] {
  if (!snap?.steps) return [];
  const out: string[] = [];
  for (const step of snap.steps) {
    for (const img of step.output?.images ?? []) {
      if (img.available && img.url) out.push(img.url);
    }
    for (const blob of step.output?.blobs ?? []) {
      if (blob.url && (blob.mimeType ?? blob.type ?? '').startsWith('image/')) {
        out.push(blob.url);
      }
    }
  }
  return out;
}
