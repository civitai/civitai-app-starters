/**
 * Sampler options per model family — the list the on-site generator shows in
 * its sampler drop-down, read from `GET /api/v1/blocks/generation-samplers`.
 *
 * WHY THIS EXISTS. A block's `textToImage` body takes `params.sampler` as a
 * free string, and which names are valid depends on the model family (the SD
 * families, Chroma, Anima's ComfyUI names, a HiDream variant…). A name the
 * family does not offer is not refused: the host replaces it with the family
 * default, so a guessed sampler silently generates with a different one. A
 * list copied into an app drifts. The platform serves the generator's own
 * list instead, derived from the same source the generator renders.
 *
 * WIRE SHAPE (any valid block token; no scope needed):
 *
 *     { ecosystems: { [ecosystemKey]: { sampler: { options, default } | null,
 *                                       byModelVersion: { [versionId]: { options, default } | null } } },
 *       baseModels: { [baseModelName]: ecosystemKey } }
 *
 * THREE ANSWERS, NEVER TWO. For a given model the catalog says one of:
 *  - `{ options, default }` — the family (or this model version) has a sampler
 *    control; offer exactly these values.
 *  - `null` — the generator shows NO sampler control for it (Flux.1, for one).
 *    Send no `sampler`.
 *  - absent — the platform could not determine the family, or does not map
 *    this base model. That is "unknown", and {@link resolveGenerationSampler}
 *    reports it as `known: false` so it can never be read as "no sampler".
 *
 * OLD PLATFORM. A civitai.com that predates the route answers `404`. The getter
 * throws {@link GenerationSamplersError} with `code: 'unsupported-platform'`
 * rather than resolving to an empty catalog, because an empty catalog would
 * read as "no family has a sampler".
 */

/** The block REST route this module reads. Resolved against the host origin. */
export const GENERATION_SAMPLERS_API_PATH = '/api/v1/blocks/generation-samplers';

/** One drop-down entry. Send `value` as `params.sampler`; show `label`. */
export interface GenerationSamplerOption {
  value: string;
  label: string;
}

/** A sampler control: its options in the generator's order, plus the value a fresh form preselects. */
export interface GenerationSamplerField {
  options: GenerationSamplerOption[];
  default: string;
}

/** One model family (keyed by ecosystem key in {@link GenerationSamplerCatalog.ecosystems}). */
export interface GenerationSamplerFamily {
  /** The family's sampler control, or `null` when the generator shows none. */
  sampler: GenerationSamplerField | null;
  /**
   * Per-model-version overrides, keyed by model version id (as a string). A
   * version listed here selects a graph variant whose sampler control differs
   * from the family's; `null` means that version has none. It takes precedence
   * over {@link sampler}.
   */
  byModelVersion: Record<string, GenerationSamplerField | null>;
}

/** What {@link fetchGenerationSamplers} resolves to. */
export interface GenerationSamplerCatalog {
  /** Families by ecosystem key. A family the platform could not determine is ABSENT, never `null`. */
  ecosystems: Record<string, GenerationSamplerFamily>;
  /** Base model name (a picker result's `baseModel`) → ecosystem key. */
  baseModels: Record<string, string>;
}

/** Why {@link fetchGenerationSamplers} failed. */
export type GenerationSamplersErrorCode =
  /** `404`: this platform does not serve the route yet (or `hostOrigin` is not civitai.com). */
  | 'unsupported-platform'
  /** `401`/`403`: the block token is missing, expired or invalid. */
  | 'unauthorized'
  /** Any other non-2xx status. */
  | 'http-error'
  /** A 2xx whose body is not the catalog shape. */
  | 'invalid-response'
  /** The fetch itself failed — offline, DNS, TLS, CORS, no `fetch` global. */
  | 'network-error';

/** Thrown by {@link fetchGenerationSamplers}. Branch on `code`, not on the message. */
export class GenerationSamplersError extends Error {
  override readonly name = 'GenerationSamplersError';
  readonly code: GenerationSamplersErrorCode;
  /** HTTP status, when the host answered. */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { code: GenerationSamplersErrorCode; status?: number | undefined; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.status = options.status;
  }
}

/** Options for {@link fetchGenerationSamplers}. */
export interface FetchGenerationSamplersOptions {
  /** The validated host origin, e.g. `useHostOrigin()` from `@civitai/blocks-react`. */
  hostOrigin: string;
  /** The raw block token, e.g. `useBlockToken().raw`. Any valid block token works. */
  token: string;
  /** Abort the request. Rejects with the underlying `AbortError`, not a `GenerationSamplersError`. */
  signal?: AbortSignal;
  /** Override `fetch` (tests, or a runtime without a global one). */
  fetch?: typeof fetch;
}

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A dictionary with no prototype, so a key like `constructor` or `__proto__` is just a key. */
function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** `undefined` = malformed. `null` is a valid value ("no sampler control"). */
function parseField(v: unknown): GenerationSamplerField | null | undefined {
  if (v === null) return null;
  if (!isRecord(v) || !Array.isArray(v.options) || typeof v.default !== 'string') return undefined;
  const options: GenerationSamplerOption[] = [];
  for (const o of v.options) {
    if (!isRecord(o) || typeof o.value !== 'string' || typeof o.label !== 'string') return undefined;
    options.push({ value: o.value, label: o.label });
  }
  return { options, default: v.default };
}

function parseFamily(v: unknown): GenerationSamplerFamily | undefined {
  if (!isRecord(v) || !isRecord(v.byModelVersion)) return undefined;
  const sampler = parseField(v.sampler);
  if (sampler === undefined) return undefined;
  const byModelVersion = dict<GenerationSamplerField | null>();
  for (const [id, raw] of Object.entries(v.byModelVersion)) {
    const field = parseField(raw);
    // One malformed override drops the WHOLE family: keeping the rest would let
    // that version fall through to the family's control, which is the wrong answer.
    if (field === undefined) return undefined;
    byModelVersion[id] = field;
  }
  return { sampler, byModelVersion };
}

/**
 * Validate a response body into a {@link GenerationSamplerCatalog}. Exported for
 * a caller that does its own fetch (for example through `@civitai/sdk`).
 *
 * A malformed family is DROPPED, so it reads as unknown — the same answer the
 * platform gives for a family it could not determine. Unknown extra fields are
 * ignored. Throws `GenerationSamplersError` (`invalid-response`) only when the
 * body is not the catalog shape at all.
 */
export function parseGenerationSamplers(body: unknown): GenerationSamplerCatalog {
  if (!isRecord(body) || !isRecord(body.ecosystems) || !isRecord(body.baseModels)) {
    throw new GenerationSamplersError(
      'generation-samplers: the response is not { ecosystems, baseModels }.',
      { code: 'invalid-response' },
    );
  }
  const ecosystems = dict<GenerationSamplerFamily>();
  for (const [key, raw] of Object.entries(body.ecosystems)) {
    const family = parseFamily(raw);
    if (family) ecosystems[key] = family;
  }
  const baseModels = dict<string>();
  for (const [name, key] of Object.entries(body.baseModels)) {
    if (typeof key === 'string') baseModels[name] = key;
  }
  return { ecosystems, baseModels };
}

/**
 * Fetch the per-family sampler catalog with a block token.
 *
 * Throws {@link GenerationSamplersError}; on a platform without the route that
 * is `code: 'unsupported-platform'`, never an empty catalog.
 *
 * @example
 * const catalog = await fetchGenerationSamplers({ hostOrigin, token: raw });
 * const lookup = resolveGenerationSampler(catalog, { baseModel: resource.baseModel, modelVersionId: resource.versionId });
 */
export async function fetchGenerationSamplers(
  opts: FetchGenerationSamplersOptions,
): Promise<GenerationSamplerCatalog> {
  const doFetch = opts.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  if (!doFetch) {
    throw new GenerationSamplersError('generation-samplers: no fetch implementation available.', {
      code: 'network-error',
    });
  }
  if (!opts.hostOrigin) {
    throw new TypeError('fetchGenerationSamplers: hostOrigin is required (wait for BLOCK_INIT).');
  }
  const url = new URL(GENERATION_SAMPLERS_API_PATH, opts.hostOrigin).toString();
  let res: Response;
  try {
    res = await doFetch(url, {
      headers: { Authorization: `Bearer ${opts.token}` },
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new GenerationSamplersError('generation-samplers: the request failed before a response.', {
      code: 'network-error',
      cause: err,
    });
  }
  if (res.status === 404) {
    throw new GenerationSamplersError(
      `generation-samplers: ${url} answered 404. This Civitai platform does not serve the ` +
        'sampler catalog yet (or hostOrigin is not the Civitai host). Treat samplers as unknown; ' +
        'do not read this as "no samplers".',
      { code: 'unsupported-platform', status: 404 },
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new GenerationSamplersError(
      `generation-samplers: ${res.status} — the block token is missing, expired or invalid.`,
      { code: 'unauthorized', status: res.status },
    );
  }
  if (!res.ok) {
    throw new GenerationSamplersError(`generation-samplers: HTTP ${res.status}.`, {
      code: 'http-error',
      status: res.status,
    });
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new GenerationSamplersError('generation-samplers: the response is not JSON.', {
      code: 'invalid-response',
      status: res.status,
      cause: err,
    });
  }
  return parseGenerationSamplers(body);
}

/** Which model to look up. Pass what a picker result carries: `baseModel` and `versionId`. */
export interface GenerationSamplerLookupInput {
  baseModel?: string | null | undefined;
  modelVersionId?: number | null | undefined;
}

/** Why {@link resolveGenerationSampler} could not answer. */
export type GenerationSamplerUnknownReason =
  /** The catalog does not map this base model to a family. */
  | 'base-model-not-in-catalog'
  /** The base model maps to a family the platform could not determine (absent from `ecosystems`). */
  | 'family-not-in-catalog'
  /** Only a model version id was given, and it has no per-version override, so the family is unknown. */
  | 'base-model-required';

/**
 * What {@link resolveGenerationSampler} returns. Narrow on `known` before
 * reading `sampler`: an unknown result has no `sampler` at all, so it cannot be
 * mistaken for `null` ("this model has no sampler control").
 */
export type GenerationSamplerLookup =
  | {
      known: true;
      /** The control to render, or `null` when the generator shows none — send no `sampler`. */
      sampler: GenerationSamplerField | null;
      /** The family's ecosystem key. */
      ecosystem: string;
      /** Whether the answer came from a per-version override or the family. */
      source: 'modelVersion' | 'family';
    }
  | { known: false; reason: GenerationSamplerUnknownReason };

/**
 * Look up the sampler control for one model. Precedence:
 *
 *  1. With `baseModel`: its family, then that family's override for
 *     `modelVersionId` if it lists one, else the family's control. This matches
 *     the host, which picks the graph by the checkpoint's base model.
 *  2. With `modelVersionId` only: the override that lists it, in whichever
 *     family. A version with no override needs `baseModel`.
 *
 * An override of `null` means that version has no sampler control; it does not
 * fall through to the family.
 */
export function resolveGenerationSampler(
  catalog: GenerationSamplerCatalog,
  input: GenerationSamplerLookupInput,
): GenerationSamplerLookup {
  const versionKey = input.modelVersionId == null ? undefined : String(input.modelVersionId);

  if (input.baseModel != null) {
    if (!hasOwn(catalog.baseModels, input.baseModel)) {
      return { known: false, reason: 'base-model-not-in-catalog' };
    }
    const ecosystem = catalog.baseModels[input.baseModel]!;
    if (!hasOwn(catalog.ecosystems, ecosystem)) {
      return { known: false, reason: 'family-not-in-catalog' };
    }
    const family = catalog.ecosystems[ecosystem]!;
    if (versionKey !== undefined && hasOwn(family.byModelVersion, versionKey)) {
      return { known: true, sampler: family.byModelVersion[versionKey] as GenerationSamplerField | null, ecosystem, source: 'modelVersion' };
    }
    return { known: true, sampler: family.sampler, ecosystem, source: 'family' };
  }

  if (versionKey !== undefined) {
    for (const [ecosystem, family] of Object.entries(catalog.ecosystems)) {
      if (hasOwn(family.byModelVersion, versionKey)) {
        return { known: true, sampler: family.byModelVersion[versionKey] as GenerationSamplerField | null, ecosystem, source: 'modelVersion' };
      }
    }
  }
  return { known: false, reason: 'base-model-required' };
}
