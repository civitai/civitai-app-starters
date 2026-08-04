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
}

/**
 * Build an {@link OrchestratorClient} from a user's access token. Pass the
 * result to the per-call helpers ({@link estimateWorkflow},
 * {@link submitWorkflow}, {@link pollWorkflow}, …). The orchestrator debits the
 * TOKEN OWNER's Buzz, so this is the user's OAuth token (or personal API key).
 *
 * @example
 * const client = createOrchestratorClient({ accessToken: tokens.access_token });
 * const body = buildTextToImageBody({ prompt: 'a fox' });
 * const estimate = await estimateWorkflow(client, body);
 */
export function createOrchestratorClient(
  opts: CreateOrchestratorClientOptions,
): OrchestratorClient {
  return {
    baseUrl: opts.baseUrl ?? DEFAULT_ORCHESTRATOR_BASE_URL,
    accessToken: opts.accessToken,
  };
}

// ---------- Raw HTTP --------------------------------------------------------

/**
 * Internal raw-fetch helper. Logs the failing response to console.error and
 * throws {@link OrchestratorError} on non-2xx. Exported so callers can build
 * their own orchestrator routes without duplicating this code.
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
    console.error(
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
 * the shape every starter's existing `buildWorkflowBody` produced. For diffusion
 * checkpoints (SDXL / Flux.1 / Pony / SD1.5) via an AIR URN `model`; for
 * closed-source image-gen APIs use {@link buildImageGenBody} instead.
 *
 * @example
 * const body = buildTextToImageBody({ prompt: 'a fox' }, { tags: ['my-app'] });
 * const estimate = await estimateWorkflow(client, body);
 * const submitted = await submitWorkflow(client, body);
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
 * without committing any Buzz. Read `cost.total` off the returned snapshot and
 * show it before {@link submitWorkflow}.
 *
 * @example
 * const estimate = await estimateWorkflow(client, body);
 * console.log(`This will cost ${estimate.cost?.total ?? 0} Buzz`);
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

/**
 * Submit a workflow for real execution. Debits the token-owner's Buzz. Returns
 * the initial snapshot — poll it to terminal with {@link pollWorkflow}.
 *
 * @example
 * const submitted = await submitWorkflow(client, body);
 * const finished = await pollWorkflow(client, submitted.id, { timeoutMs: 30_000 });
 * const urls = extractImageUrls(finished);
 */
export function submitWorkflow(
  client: OrchestratorClient,
  body: unknown,
): Promise<WorkflowSnapshot> {
  return callOrchestrator(client, '/v2/consumer/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as Promise<WorkflowSnapshot>;
}

/** Per-call controls for {@link getWorkflow}. */
export interface GetWorkflowOptions {
  /**
   * 🔴 THE ORCHESTRATOR'S OWN LONG-POLL HOLD, IN **SECONDS**, NOT MILLISECONDS.
   *
   * Sent as the `?wait=` query parameter, which the orchestrator documents as
   * *"Whether to wait for the workflow to complete before returning or to
   * return immediately. The request may return a 202 if the client waits for
   * the workflow to complete and the workflow does not complete within the
   * requested timeout."*
   *
   * The unit is seconds. That is not obvious from the parameter's name and
   * getting it wrong is silent in both directions — `wait: 30000` asks for
   * ~8 hours and `wait: 0.03` rounds to nothing — so it is spelled out here and
   * in the option's name. Omit (or `0`) for the pre-existing one-shot read.
   *
   * A 202 is a NORMAL outcome, not an error: `callOrchestrator` treats every
   * 2xx as success, so a timed-out hold returns the current (non-terminal)
   * snapshot exactly like a 200 would. Callers re-arm; see {@link pollWorkflow}.
   */
  waitSeconds?: number;
  /**
   * Abort signal forwarded to `fetch`, so a long hold is genuinely CANCELLED
   * rather than merely abandoned. A `Promise.race` against a timer leaves the
   * underlying request in flight holding a socket, which is precisely the
   * failure mode a long poll makes expensive.
   */
  signal?: AbortSignal;
}

/**
 * Fetch a single workflow's current snapshot by id.
 *
 * One-shot by default. Pass {@link GetWorkflowOptions.waitSeconds} to have the
 * ORCHESTRATOR hold the request open until the workflow reaches a terminal
 * status (a real long poll, server-side) instead of returning immediately; for
 * a full "wait until done, re-arming across timeouts" loop use
 * {@link pollWorkflow}.
 *
 * @example
 * const snap = await getWorkflow(client, workflowId);
 * if (isTerminal(snap)) console.log(extractImageUrls(snap));
 *
 * @example  Long poll: one request that returns as soon as the workflow ends
 * const snap = await getWorkflow(client, workflowId, { waitSeconds: 20 });
 * // A non-terminal snapshot here means the hold elapsed (HTTP 202) — ask again.
 * if (!isTerminal(snap)) await getWorkflow(client, workflowId, { waitSeconds: 20 });
 */
export function getWorkflow(
  client: OrchestratorClient,
  workflowId: string,
  opts: GetWorkflowOptions = {},
): Promise<WorkflowSnapshot> {
  // Built with URLSearchParams rather than string concatenation so a future
  // second parameter cannot reintroduce a `?`-vs-`&` bug, and so a non-finite
  // `waitSeconds` can never be serialised into the URL.
  const wait =
    typeof opts.waitSeconds === 'number' && Number.isFinite(opts.waitSeconds)
      ? Math.max(0, Math.floor(opts.waitSeconds))
      : 0;
  const qs = wait > 0 ? `?${new URLSearchParams({ wait: String(wait) }).toString()}` : '';
  return callOrchestrator(client, `/v2/consumer/workflows/${encodeURIComponent(workflowId)}${qs}`, {
    method: 'GET',
    ...(opts.signal ? { signal: opts.signal } : {}),
  }) as Promise<WorkflowSnapshot>;
}

// ---------- Polling ---------------------------------------------------------

/**
 * Default orchestrator-side hold per {@link pollWorkflow} attempt, in seconds.
 *
 * 20s rather than something larger because a held request occupies a socket on
 * BOTH sides for its whole duration, and because the platforms these starters
 * deploy to cap total request time (see PORTING.md's serverless note). It turns
 * the default 30s budget from ~30 requests into ~2 while DETECTING completion
 * sooner, not later — the hold returns the instant the workflow ends.
 */
export const DEFAULT_POLL_WAIT_SECONDS = 20;

/**
 * Slack added to a per-attempt abort deadline, in ms.
 *
 * 🔴 THE ABORT MUST SIT ABOVE THE HOLD, NOT AT IT. `waitSeconds` is what we ASK
 * the orchestrator to hold for; the abort is this side's defence against a
 * socket it accepted and abandoned, which `wait` cannot cover because a request
 * that never returns never times out. Set equal to the hold, the abort would
 * race the orchestrator's own timely 202 and cancel healthy requests.
 */
const POLL_ABORT_SLACK_MS = 5_000;

export interface PollWorkflowOptions {
  /**
   * Delay BETWEEN attempts, in ms. Default 1000.
   *
   * 🔴 KEPT, AND LOAD-BEARING, EVEN THOUGH LONG POLLING MAKES IT LOOK
   * REDUNDANT. With `waitSeconds > 0` an attempt normally consumes the whole
   * hold, so this is ~3% overhead on a cycle. But if the orchestrator ever
   * stops honouring `wait` — an older deployment, a proxy that strips the query
   * string, a 202 returned instantly — a zero gap turns this loop into a hot
   * loop hammering the API at fetch speed. This delay is the floor that makes
   * that failure slow instead of catastrophic.
   */
  intervalMs?: number;
  /** Max total time to poll in ms. Default 30000. */
  timeoutMs?: number;
  /** Optional abort signal — cancels the in-flight request and stops the loop. */
  signal?: AbortSignal;
  /**
   * Orchestrator-side hold per attempt, in **seconds**. Default
   * {@link DEFAULT_POLL_WAIT_SECONDS}. Pass `0` to restore the pre-0.31
   * pure-timer behaviour (one immediate read per `intervalMs`).
   *
   * Automatically clamped down to the time left on `timeoutMs`, so a long hold
   * cannot overrun the caller's budget.
   */
  waitSeconds?: number;
}

/**
 * Wait for a workflow to reach a terminal status, using the orchestrator's
 * SERVER-SIDE long poll (`?wait=`) and re-arming across each 202 until the
 * workflow ends, the `timeoutMs` budget elapses, or `signal` aborts. Returns
 * the latest snapshot regardless of which condition tripped — callers inspect
 * {@link isTerminal} on the result to decide what to do.
 *
 * 🔴 THIS FUNCTION USED TO BE LABELLED A LONG POLL AND WAS NOT ONE. Until
 * @civitai/app-sdk 0.31.0 it was a client-side `setTimeout` loop re-reading the
 * workflow every `intervalMs` (default 1000) with no `wait` parameter — i.e. a
 * TIMER poll wearing a long poll's docstring, and the same false claim had
 * propagated into this package's README (its API table and the "`pollWorkflow`
 * long-polls to terminal status" line). The label is now true rather than
 * softened, because the orchestrator has supported the parameter all along and
 * four non-blocks civitai call sites were already using it.
 *
 * (PORTING.md's "long-poll" wording is NOT part of that: it describes the
 * BLOCK-IN-THE-HANDLER pattern, which the starters genuinely did regardless of
 * the mechanism underneath, and its advice to cap `timeoutMs` under the
 * platform budget is still correct — more so now that the hold is real.)
 *
 * WHAT A CALLER SEES THAT IS DIFFERENT: fewer requests (~2 instead of ~30 on
 * the default budget) and terminal status detected sooner (the hold returns
 * when the workflow ends, not on the next tick after it ended). The RETURN
 * CONTRACT is unchanged.
 *
 * @example
 * const finished = await pollWorkflow(client, submitted.id, { timeoutMs: 30_000 });
 * if (isTerminal(finished)) console.log(extractImageUrls(finished));
 */
export async function pollWorkflow(
  client: OrchestratorClient,
  workflowId: string,
  opts: PollWorkflowOptions = {},
): Promise<WorkflowSnapshot> {
  const interval = opts.intervalMs ?? 1000;
  const timeout = opts.timeoutMs ?? 30_000;
  const requestedWait = opts.waitSeconds ?? DEFAULT_POLL_WAIT_SECONDS;
  const deadline = Date.now() + timeout;

  // The hold this attempt may ask for: the caller's `waitSeconds`, floored at 0
  // and clamped to whatever is LEFT of the total budget, so a 20s hold started
  // with 3s remaining asks for 3s rather than overrunning by 17.
  const holdFor = (): number => {
    if (!Number.isFinite(requestedWait) || requestedWait <= 0) return 0;
    const remainingSeconds = Math.floor((deadline - Date.now()) / 1000);
    return Math.max(0, Math.min(Math.floor(requestedWait), remainingSeconds));
  };

  const attempt = (waitSeconds: number): Promise<WorkflowSnapshot> => {
    if (waitSeconds <= 0) {
      return getWorkflow(client, workflowId, {
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    }
    // Per-attempt deadline as a real AbortController — the fetch is CANCELLED,
    // not just stopped being awaited. Linked to the caller's signal by hand
    // rather than via `AbortSignal.any`, which is too new to require of every
    // browser this client-safe package runs in.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), waitSeconds * 1000 + POLL_ABORT_SLACK_MS);
    const onOuterAbort = () => ctl.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);
    return getWorkflow(client, workflowId, { waitSeconds, signal: ctl.signal }).finally(() => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
    });
  };

  // The FIRST read is not wrapped: a throw here propagates, exactly as it did
  // before long polling existed. There is no prior snapshot to fall back to, so
  // swallowing it would return `undefined` typed as a snapshot.
  let snapshot = await attempt(holdFor());
  while (!isTerminal(snapshot) && Date.now() + interval <= deadline) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, interval));
    if (opts.signal?.aborted) break;
    try {
      snapshot = await attempt(holdFor());
    } catch (err) {
      // 🔴 A LATER ATTEMPT'S ABORT MUST NOT DESTROY A SNAPSHOT WE ALREADY HAVE.
      // Both this function's own per-attempt deadline and the caller's signal
      // surface as an abort throw. Neither is news about the workflow, and the
      // documented contract is "returns the latest snapshot" — so we keep the
      // one we hold and stop. Any OTHER error still propagates, which is what
      // the pre-long-poll loop did for every error.
      if (!isAbortError(err)) throw err;
      break;
    }
  }
  return snapshot;
}

/**
 * Is this thrown value an abort (either our per-attempt deadline or the
 * caller's signal)?
 *
 * Matched on `name`, not `instanceof DOMException`: the abort reason is
 * produced by whichever fetch implementation is in play (undici, a browser, a
 * test double), and those do not share a class. Node's undici throws a
 * `DOMException` named `AbortError`; a polyfilled or mocked fetch may throw a
 * plain `Error` with the same name.
 */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

// ---------- Snapshot inspection --------------------------------------------

/**
 * True when a snapshot has reached a terminal status (`succeeded` | `failed` |
 * `expired` | `canceled`) — i.e. no further polling is needed. Null/undefined
 * or a status-less snapshot is treated as non-terminal.
 *
 * @example
 * if (isTerminal(snap)) stopPolling();
 */
export function isTerminal(snap: WorkflowSnapshot | null | undefined): boolean {
  if (!snap?.status) return false;
  return (TERMINAL_STATUSES as readonly string[]).includes(String(snap.status));
}

/**
 * Pull every available image URL out of a workflow snapshot — reads both the
 * canonical `output.images[]` and the legacy `output.blobs[]` (image/* only).
 *
 * @example
 * const urls = extractImageUrls(finished);   // string[]
 * urls.forEach((u) => render(<img src={u} />));
 */
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
