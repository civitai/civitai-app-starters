/**
 * The data side of `<civitai-resource-picker>`: what a source is, the source
 * that ships with it, and its parser.
 *
 * It reads `GET /api/v1/blocks/models`, the block-token-gated, maturity-clamped
 * catalog. 🔴 It never falls back to the public `/api/v1/models`: that
 * endpoint knows no `owner` parameter, so a fallback would answer "my
 * workflows" with everybody's. A failure here is a failure, shown as one.
 */
/** Which list a search reads: the viewer's own published resources, or anyone's. */
export type ResourceOwner = 'mine' | 'any';

/** One search, as the picker asks for it. */
export interface ResourceSearchParams {
  /** Model types, sent as repeated `types=` parameters. At least one. */
  types: readonly string[];
  owner: ResourceOwner;
  /** Free text. Empty or whitespace is not sent. */
  query?: string;
  /** The `nextCursor` of the page before this one. */
  cursor?: string;
  /** 1–100; the server's own default (100) applies when absent. */
  limit?: number;
}

/** One published version of a resource. */
export interface ResourceVersion {
  id: number;
  name: string;
  baseModel: string | null;
  /**
   * Who can download it today. `early-access`: a timed paid-access gate (the
   * server's `paidAccess` with `permanent: false`); `paid`: a permanent one.
   * Absent means `open`. Listed either way — the badge is the warning.
   */
  access?: ResourceAccess;
  /** When early access ends (an ISO string), when the server knows it. */
  earlyAccessDeadline?: string;
}

/** Who can download a version today. */
export type ResourceAccess = 'open' | 'early-access' | 'paid';

/** One resource (a model), with its versions newest first. */
export interface ResourceItem {
  modelId: number;
  name: string;
  /** The model type, e.g. `Workflows`. */
  type: string;
  creatorUsername: string | null;
  /** Newest first, in the order the server listed them. Never empty. */
  versions: ResourceVersion[];
}

/** One page of a search. */
export interface ResourcePage {
  items: ResourceItem[];
  nextCursor: string | null;
  /**
   * The filter the SERVER says it applied. A source must report `'mine'` only
   * when the response said so; the picker refuses a `mine` search answered any
   * other way.
   */
  owner: ResourceOwner;
}

/** Where the picker's results come from. */
export interface ResourceSource {
  /**
   * One page. Reject with a {@link ResourceSourceError} to tell the picker
   * whether waiting would help; any other rejection is shown as a plain error.
   * Reject when `signal` aborts — the picker ignores the result either way.
   */
  search(params: ResourceSearchParams, signal: AbortSignal): Promise<ResourcePage>;
}

/** Why a search failed, in the terms the picker acts on. */
export type ResourceSourceErrorKind =
  /** 429 or 503: worth retrying after `retryAfterMs`. */
  | 'busy'
  /** 401: no signed-in viewer (or a token that no longer works). */
  | 'unauthorized'
  /** A `mine` search answered without `metadata.owner: 'mine'`. */
  | 'owner-unsupported'
  /** Any other status, an unreadable body, or no response at all. */
  | 'failed';

export class ResourceSourceError extends Error {
  readonly kind: ResourceSourceErrorKind;
  readonly status?: number;
  /** For `busy`: how long the server asked us to wait. */
  readonly retryAfterMs?: number;

  constructor(
    kind: ResourceSourceErrorKind,
    message: string,
    options: { status?: number; retryAfterMs?: number } = {}
  ) {
    super(message);
    this.name = 'ResourceSourceError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** What a pick resolves to. */
export interface PickedResource {
  modelId: number;
  modelVersionId: number;
  /** The model's name. */
  name: string;
  versionName: string;
  creatorUsername: string | null;
  baseModel: string | null;
  earlyAccessDeadline?: string;
  /**
   * Who can download the picked version today. The viewer may not be able to
   * download an `early-access` or `paid` version later.
   */
  access: ResourceAccess;
  /**
   * Which list the pick came from. 🔴 A UX hint, never proof of ownership: the
   * app can set this to anything, so a server that needs "this is the viewer's
   * own resource" must check it itself.
   */
  owner: ResourceOwner;
}

/** The catalog route, relative to an origin. */
export const BLOCK_MODELS_PATH = '/api/v1/blocks/models';

/** Used when a 429/503 carries no usable `Retry-After`. */
export const DEFAULT_RETRY_AFTER_MS = 2000;

/** The query a search sends, as ordered pairs (`types` repeats). */
export function resourceSearchQuery(params: ResourceSearchParams): [string, string][] {
  const pairs: [string, string][] = params.types.map((type) => ['types', type]);
  pairs.push(['owner', params.owner]);
  const query = params.query?.trim();
  if (query) pairs.push(['query', query]);
  if (params.limit !== undefined) {
    pairs.push(['limit', String(Math.max(1, Math.min(100, Math.floor(params.limit))))]);
  }
  if (params.cursor) pairs.push(['cursor', params.cursor]);
  return pairs;
}

/** The full URL {@link blockTokenSource} fetches for a search. */
export function buildResourceSearchUrl(origin: string, params: ResourceSearchParams): string {
  let base = origin;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}${BLOCK_MODELS_PATH}?${new URLSearchParams(resourceSearchQuery(params)).toString()}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

function parseVersion(raw: unknown): ResourceVersion | null {
  if (!isRecord(raw) || typeof raw.id !== 'number') return null;
  // The gate is `paidAccess` ({ permanent, endsAt }, null when ungated or the
  // gate has lapsed). The server's `earlyAccessDeadline` is a copy of a timed
  // gate's `endsAt`, so it is not read. `availability` says nothing here:
  // early access is a Public version behind a gate.
  const gate = isRecord(raw.paidAccess) ? raw.paidAccess : null;
  const access: ResourceAccess = gate ? (gate.permanent === true ? 'paid' : 'early-access') : 'open';
  const deadline = access === 'early-access' ? text(gate!.endsAt) : null;
  return {
    id: raw.id,
    name: text(raw.name) ?? `Version ${raw.id}`,
    baseModel: text(raw.baseModel),
    access,
    ...(deadline ? { earlyAccessDeadline: deadline } : {}),
  };
}

function parseItem(raw: unknown): ResourceItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'number') return null;
  const versions = (Array.isArray(raw.modelVersions) ? raw.modelVersions : [])
    .map(parseVersion)
    .filter((version): version is ResourceVersion => version !== null);
  if (versions.length === 0) return null;
  return {
    modelId: raw.id,
    name: text(raw.name) ?? `Model ${raw.id}`,
    type: text(raw.type) ?? '',
    creatorUsername: isRecord(raw.creator) ? text(raw.creator.username) : null,
    versions,
  };
}

/**
 * Read a `/blocks/models` body. Rows without an id or a version are skipped.
 *
 * `owner` is the server's `metadata.owner` echo, and anything but `'mine'` —
 * absent included — reads as `'any'`: a server older than the parameter
 * ignores it and does not echo. Judging a `mine` search by that echo is the
 * picker's job, done in one place, so this only reports it.
 */
export function parseResourcePage(body: unknown): ResourcePage {
  if (!isRecord(body)) {
    throw new ResourceSourceError('failed', 'The catalog sent a response it could not read.');
  }
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const echoed: ResourceOwner = metadata.owner === 'mine' ? 'mine' : 'any';
  const items = (Array.isArray(body.items) ? body.items : [])
    .map(parseItem)
    .filter((item): item is ResourceItem => item !== null);
  return { items, nextCursor: text(metadata.nextCursor), owner: echoed };
}

/** `Retry-After` in seconds (the only form this server sends) → ms. */
function retryAfterMs(header: string | null): number {
  const seconds = header === null ? NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
}

/** The error a non-OK status becomes, before any body is read. */
export function errorForStatus(status: number, retryAfter: string | null = null): ResourceSourceError {
  if (status === 429 || status === 503) {
    return new ResourceSourceError('busy', 'Civitai is busy right now.', {
      status,
      retryAfterMs: retryAfterMs(retryAfter),
    });
  }
  if (status === 401) {
    return new ResourceSourceError('unauthorized', 'Sign in to Civitai to see this list.', { status });
  }
  return new ResourceSourceError('failed', `The catalog request failed (${status}).`, { status });
}

export interface BlockTokenSourceOptions {
  /**
   * The host origin the token was minted for, e.g. `useHostOrigin()` in
   * `@civitai/blocks-react`. The token goes only here.
   */
  origin: string;
  /**
   * The raw block token, read at each request so a refreshed one is used.
   * Called with `{ fresh: true }` once after a `401`: return a newly minted
   * token if you can (`useBlockToken().refresh()`), and the search is retried
   * with it. Returning the same token ends it as `unauthorized`.
   */
  getToken: (options?: { fresh: boolean }) => string | Promise<string>;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * A source that calls `/api/v1/blocks/models` with a raw block token and plain
 * `fetch` — no `@civitai/sdk`. It never calls any other route.
 */
export function blockTokenSource(options: BlockTokenSourceOptions): ResourceSource {
  return {
    async search(params, signal) {
      const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
      const url = buildResourceSearchUrl(options.origin, params);
      const send = async (token: string): Promise<Response> => {
        try {
          return await doFetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
        } catch (error) {
          if (signal.aborted) throw error;
          throw new ResourceSourceError('failed', 'Could not reach Civitai.');
        }
      };
      const token = await options.getToken({ fresh: false });
      let response = await send(token);
      // One retry, as @civitai/sdk's client does: a block token that expired
      // while the tab slept is routine. A second 401, or no newer token to
      // send, is the viewer's — `unauthorized`.
      if (response.status === 401) {
        const fresh = await options.getToken({ fresh: true });
        if (signal.aborted) throw signal.reason;
        if (fresh !== token) response = await send(fresh);
      }
      if (!response.ok) throw errorForStatus(response.status, response.headers.get('Retry-After'));
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ResourceSourceError('failed', 'The catalog sent a response it could not read.');
      }
      return parseResourcePage(body);
    },
  };
}
