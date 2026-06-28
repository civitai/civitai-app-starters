/**
 * SDK-internal catalog client for the LIVE host's in-harness resource picker
 * (Phase 1 of "make `dev:live` a faithful local host").
 *
 * The real platform host opens civitai's OWN model-picker modal when a block
 * sends `OPEN_CHECKPOINT_PICKER` / `OPEN_RESOURCE_PICKER`. Locally, `dev:live`
 * has no civitai chrome — so {@link createLiveHost} serves a PROTOCOL-IDENTICAL
 * equivalent: a tiny in-harness catalog browser backed by this client. The
 * block code (`useCheckpointPicker` / `useResourcePicker`) is byte-identical to
 * production; only the picker chrome differs.
 *
 * TWO READ PATHS (mirrors the reference block-side catalog client), chosen by
 * whether a block token is present:
 *
 *  1. AUTHORITATIVE (the live host always has the dev block token): the
 *     block-gated endpoint `/api/v1/blocks/models` with
 *     `Authorization: Bearer <token>` (civitai PR #2671). Same response shape as
 *     the public `/api/v1/models` but AUTHORITATIVELY CLAMPS the catalog's
 *     browsing level to the token's signed `maxBrowsingLevel` ceiling. The
 *     client NEVER sends `nsfw`/`browsingLevel` — maturity is server-enforced.
 *     The page block token CAN read `/blocks/models` (no extra scope).
 *
 *  2. PUBLIC (graceful fallback): `/api/v1/models` is a MixedAuthEndpoint
 *     returning `Access-Control-Allow-Origin: *`. We pass `nsfw=false` for an
 *     advisory-SFW view. Used only when the authoritative path isn't deployed /
 *     authorized yet (404/401/403) or throws (CORS/network).
 *
 * MONEY-SAFETY: a pick from this catalog is DISCOVERY ONLY. The returned
 * `versionId` is a HINT, never an entitlement — the server re-validates AND
 * prices every id at estimate/submit (the page gate + orchestrator belt). A
 * browse here, authoritative or public, never moves Buzz and never implies the
 * pick is trusted.
 *
 * Everything here is pure + node-testable: the URL/param builders, the
 * response→option mappers (`BlockCheckpointInfo` / `BlockResourceInfo`), and a
 * thin fetch client that takes an injectable `fetch` (tests drive success /
 * empty / non-OK / throw / fallback without a real network).
 */

import type { BlockCheckpointInfo, BlockResourceInfo } from '@civitai/app-sdk/blocks';

/** The public REST base. */
export const CATALOG_API_BASE = '/api/v1/models';

/** The authoritative, block-token-gated, maturity-clamped catalog base (#2671). */
export const CATALOG_API_BASE_BLOCKS = '/api/v1/blocks/models';

/** The REST `types` filter value for each picker model type. */
export type CatalogModelType = 'Checkpoint' | 'LORA';

/** Default page size — small enough to keep the grid + payload light. */
export const DEFAULT_LIMIT = 24;

/** Default thumbnail width requested from the image edge (cache-aligned). */
export const THUMB_WIDTH = 320;

export interface CatalogQuery {
  /** Which model type to browse — maps directly to the REST `types` param. */
  types: CatalogModelType;
  /** Meili text search; empty/whitespace → omitted (default popular view). */
  query?: string;
  /** ≤100 (server cap). Defaults to {@link DEFAULT_LIMIT}. */
  limit?: number;
  cursor?: string;
  /**
   * Server-side family filter — the REST `baseModels` param. A baseModel NAME
   * (e.g. 'SDXL 1.0', 'Flux.1 D', 'Illustrious') the server matches exactly so
   * the page is FULL of the requested family (not a generic page narrowed
   * client-side). Empty/whitespace → omitted. Both the authoritative
   * (`/blocks/models`) and public (`/api/v1/models`) bases accept it (the former
   * is a behavior-preserving DRY refactor of the latter — civitai #2671). A
   * value that matches no baseModel name (e.g. an ecosystem KEY like 'Flux1')
   * yields an empty page → {@link fetchCatalog} retries once without it.
   */
  baseModels?: string;
}

export interface BuildUrlOptions {
  base?: string;
  /**
   * Append `nsfw=false` (advisory SFW). Only the PUBLIC endpoint reads this; the
   * authoritative `/blocks/models` IGNORES client maturity (server clamps), so we
   * never send it there. Defaults to `false`.
   */
  sfwOnly?: boolean;
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

/**
 * Build a catalog URL for a query. Pure + deterministic so the request is
 * stable. Empty query is omitted (the default popular view). `limit` is clamped
 * to [1, 100]. `sfwOnly` appends `nsfw=false` — PUBLIC endpoint only.
 *
 * `baseOrOpts` may be a bare base string (back-compat) or a {@link BuildUrlOptions}.
 */
export function buildCatalogUrl(
  q: CatalogQuery,
  baseOrOpts: string | BuildUrlOptions = CATALOG_API_BASE,
): string {
  const opts: BuildUrlOptions = typeof baseOrOpts === 'string' ? { base: baseOrOpts } : baseOrOpts;
  const base = opts.base ?? CATALOG_API_BASE;
  const params = new URLSearchParams();
  params.set('types', q.types);
  const query = q.query?.trim();
  if (query) params.set('query', query);
  params.set('limit', String(clampLimit(q.limit ?? DEFAULT_LIMIT)));
  if (q.cursor) params.set('cursor', q.cursor);
  const baseModels = q.baseModels?.trim();
  if (baseModels) params.set('baseModels', baseModels);
  if (opts.sfwOnly) params.set('nsfw', 'false');
  return `${base}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Response shapes (minimal — only the fields we read). Tolerant of missing
// fields (malformed payload → row skipped, never throws).
// ---------------------------------------------------------------------------

interface RawImage {
  url?: string;
  /** API media kind — 'image' | 'video'. A video cover must NEVER seed an <img>. */
  type?: string;
}
interface RawModelVersion {
  id?: number;
  name?: string;
  baseModel?: string;
  images?: RawImage[];
}
interface RawModel {
  id?: number;
  name?: string;
  type?: string;
  nsfw?: boolean;
  modelVersions?: RawModelVersion[];
}
interface RawResponse {
  items?: RawModel[];
  metadata?: { nextCursor?: string | null };
}

/**
 * A normalized card the in-harness grid renders. One per model (its top
 * version). Carries everything {@link cardToCheckpoint} / {@link cardToResource}
 * need to build the protocol-identical picker reply payload.
 */
export interface CatalogCard {
  modelId: number;
  versionId: number;
  modelName: string;
  versionName: string;
  baseModel: string;
  modelType: string;
  thumbnailUrl: string | null;
  nsfw: boolean;
}

export interface CatalogPage {
  cards: CatalogCard[];
  nextCursor: string | null;
}

function thumbTransformSegment(width: number): string {
  return `width=${width},optimized=true`;
}

/**
 * Rewrite a Civitai image edge URL to a small, optimized thumbnail so we hit the
 * CDN-cached variant instead of an origin transcode. Handles `original=true`,
 * `width=NNN`, or no transform segment. Pure + total — never throws.
 */
export function edgeThumb(url: string, width: number = THUMB_WIDTH): string {
  if (!url || typeof url !== 'string') return url;
  const w = Math.max(32, Math.floor(width));
  const seg = thumbTransformSegment(w);
  if (/\/original=true\//.test(url)) return url.replace(/\/original=true\//, `/${seg}/`);
  if (/\/width=\d+(?:,[^/]*)?\//.test(url)) {
    return url.replace(/\/width=\d+(?:,[^/]*)?\//, `/${seg}/`);
  }
  if (isCivitaiImageHost(url)) {
    const lastSlash = url.lastIndexOf('/');
    if (lastSlash > 0) return `${url.slice(0, lastSlash)}/${seg}${url.slice(lastSlash)}`;
  }
  return url;
}

/** Civitai image-edge hosts whose URLs we rewrite to a cached thumbnail variant. */
const CIVITAI_IMAGE_HOSTS = new Set(['image.civitai.com', 'imagecache.civitai.com']);

/**
 * True iff `url` is served by a Civitai image-edge HOST. Parses the URL and
 * checks the exact hostname (not a substring `.includes`, which a crafted URL
 * like `https://evil.example/image.civitai.com/x` would defeat). Total — a
 * malformed/relative URL yields `false` (no rewrite).
 */
function isCivitaiImageHost(url: string): boolean {
  try {
    return CIVITAI_IMAGE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Strip trailing '/' from a base URL in linear time. Avoids the regex
 * `/\/+$/` whose backtracking is polynomial (ReDoS) on a long run of slashes.
 */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return s.slice(0, end);
}

/** Trailing media extensions we treat as VIDEO (never a valid <img src>). */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'] as const;

/**
 * True iff `im` is VIDEO media — by explicit `type: 'video'` OR a video file
 * extension on its url. A video cover served into an `<img>` downloads the FULL
 * file (verified: a model-version video cover returns HTTP 200 video/mp4 ~73 MB)
 * and renders nothing, AND the edge transcode-to-jpeg trick does NOT defuse it
 * (still serves the mp4) — so a video must never be selected as the thumbnail.
 *
 * Extension test is a case-insensitive `endsWith` (no backtracking/ReDoS regex,
 * no host-style `.includes`). These catalog urls have no query string — they end
 * `/<id>.<ext>` — but we strip at the first `?` defensively before testing.
 */
function isVideoMedia(im: RawImage): boolean {
  if (im?.type === 'video') return true;
  const url = im?.url;
  if (typeof url !== 'string' || url.length === 0) return false;
  const q = url.indexOf('?');
  const path = (q >= 0 ? url.slice(0, q) : url).toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Map ONE raw model → a card using its FIRST modelVersion (REST default order
 * puts the latest/primary first) and that version's first NON-VIDEO image.
 * Returns `null` for an unusable row (no version id). Tolerant of any missing
 * field. A version with only video media → `thumbnailUrl: null` (the overlay
 * renders the neutral placeholder tile; never a broken/heavy mp4 in an <img>).
 */
export function modelToCard(
  raw: RawModel | null | undefined,
  imageWidth = THUMB_WIDTH,
): CatalogCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const version = raw.modelVersions?.[0];
  const versionId = version?.id;
  if (typeof versionId !== 'number' || !Number.isFinite(versionId)) return null;
  const modelId = typeof raw.id === 'number' ? raw.id : 0;
  const cover = version?.images?.find(
    (im) => typeof im?.url === 'string' && im.url.length > 0 && !isVideoMedia(im),
  );
  return {
    modelId,
    versionId,
    modelName: (raw.name ?? '').trim() || `Model #${modelId || versionId}`,
    versionName: (version?.name ?? '').trim(),
    baseModel: (version?.baseModel ?? '').trim(),
    modelType: (raw.type ?? '').trim(),
    thumbnailUrl: cover?.url ? edgeThumb(cover.url, imageWidth) : null,
    nsfw: raw.nsfw === true,
  };
}

/** Map a full raw response → a page of cards + the next cursor. Never throws. */
export function responseToPage(
  raw: RawResponse | null | undefined,
  imageWidth = THUMB_WIDTH,
): CatalogPage {
  const items = Array.isArray(raw?.items) ? raw!.items! : [];
  const cards: CatalogCard[] = [];
  for (const item of items) {
    const card = modelToCard(item, imageWidth);
    if (card) cards.push(card);
  }
  const nextCursor = raw?.metadata?.nextCursor ?? null;
  return { cards, nextCursor: typeof nextCursor === 'string' && nextCursor ? nextCursor : null };
}

/**
 * Map a browsed card → the EXACT `BlockCheckpointInfo` shape the production host
 * returns in `CHECKPOINT_PICKER_RESULT.selected`. Protocol fidelity: the block's
 * `useCheckpointPicker()` consumes this identically in dev:live and in prod.
 */
export function cardToCheckpoint(card: CatalogCard): BlockCheckpointInfo {
  return {
    versionId: card.versionId,
    modelId: card.modelId,
    modelName: card.modelName,
    versionName: card.versionName,
    baseModel: card.baseModel,
  };
}

/**
 * Map a browsed card → the EXACT `BlockResourceInfo` shape the production host
 * returns in `RESOURCE_PICKER_RESULT.selected`. `modelType` is the canonical
 * type the host resolved (e.g. 'Checkpoint' | 'LORA').
 */
export function cardToResource(card: CatalogCard, modelType: string): BlockResourceInfo {
  return {
    versionId: card.versionId,
    modelId: card.modelId,
    modelName: card.modelName,
    versionName: card.versionName,
    baseModel: card.baseModel,
    // Prefer the REST-reported type; fall back to the requested picker type.
    modelType: card.modelType || modelType,
  };
}

/**
 * Client-side family hint: keep only cards whose `baseModel` plausibly matches
 * the requested `baseModelGroup` (ecosystem key like 'Flux1'/'SDXL' OR a
 * baseModel name like 'Flux.1 D'). Loose substring/token match — the REAL family
 * constraint is server-enforced at submit; this is purely a dev-UX convenience
 * that NARROWS the browse, never widens it. An empty/absent group returns the
 * cards unchanged.
 */
export function filterCardsByFamily(
  cards: CatalogCard[],
  baseModelGroup: string | undefined,
): CatalogCard[] {
  const group = baseModelGroup?.trim();
  if (!group) return cards;
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = norm(group);
  if (!needle) return cards;
  const matched = cards.filter((c) => {
    const hay = norm(c.baseModel);
    if (!hay) return false;
    return hay.includes(needle) || needle.includes(hay);
  });
  // Don't hand back an empty grid just because the hint was unusual — if nothing
  // matched, fall back to the full set so the dev can still pick. (Server is the
  // real constraint at submit.)
  return matched.length > 0 ? matched : cards;
}

// ---------------------------------------------------------------------------
// The fetch client. Uses the standard `fetch` Response shape (`ok`/`status`/
// `json()`) so the live host's injectable `fetchImpl` (and tests' mock) work
// unchanged. Returns a discriminated result instead of throwing so the overlay
// can show retry/empty.
// ---------------------------------------------------------------------------

export type CatalogResult =
  | { kind: 'ok'; page: CatalogPage; authoritative: boolean }
  | { kind: 'empty'; authoritative: boolean }
  | { kind: 'error'; status?: number; message: string };

export type FallbackInfo = { status: number } | { reason: 'network' };

/** Statuses that mean "not available yet / not authorized → fall back to public". */
function isFallbackStatus(status: number): boolean {
  return status === 404 || status === 401 || status === 403;
}

async function toResult(
  res: { ok: boolean; status: number; json: () => Promise<unknown> },
  authoritative: boolean,
  imageWidth?: number,
): Promise<CatalogResult> {
  if (!res.ok) {
    return { kind: 'error', status: res.status, message: `request failed (${res.status})` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      kind: 'error',
      status: res.status,
      message: err instanceof Error ? err.message : 'bad JSON',
    };
  }
  const page = responseToPage(body as RawResponse, imageWidth);
  if (page.cards.length === 0) return { kind: 'empty', authoritative };
  return { kind: 'ok', page, authoritative };
}

export interface FetchCatalogDeps {
  /** Injectable `fetch` — the live host passes its own `fetchImpl`. */
  fetch: typeof fetch;
  /** Backend origin (e.g. `https://civitai.com`) the relative bases resolve against. */
  baseUrl: string;
  /** Raw block JWT. Present → authoritative path with fallback. Absent → public. */
  token?: string | null;
  imageWidth?: number;
  /** Advisory SFW for the PUBLIC read. Defaults to true (fail-closed SFW). */
  anonSfwOnly?: boolean;
  onFallback?: (info: FallbackInfo) => void;
}

/**
 * Fetch one catalog page, choosing the authoritative (token, maturity-clamped)
 * or public (advisory-SFW) endpoint and gracefully falling back from the former
 * to the latter when it isn't deployed / authorized yet (404/401/403) or throws
 * (CORS/preflight/network). A failure on the PUBLIC path is a hard error (no
 * infinite loop). Never throws.
 *
 * EMPTY-FAMILY RETRY: when `q.baseModels` is set and the family-filtered read
 * resolves `kind:'empty'`, retry ONCE with `baseModels` cleared. The picker may
 * pass an ecosystem KEY ('Flux1'/'SDXL') that matches no baseModel NAME exactly
 * — without this, the dev would see a blank grid instead of a generic page. The
 * retry runs on BOTH the authoritative and the public read path, exactly once
 * (no loop). A non-empty family page is returned as-is (the server already did
 * the real family filter — no client-side narrowing).
 */
export async function fetchCatalog(q: CatalogQuery, deps: FetchCatalogDeps): Promise<CatalogResult> {
  const baseUrl = stripTrailingSlashes(deps.baseUrl);
  const token = deps.token;
  const anonSfwOnly = deps.anonSfwOnly !== false;
  const familyFilter = q.baseModels?.trim();

  const fetchPublic = async (sfwOnly: boolean): Promise<CatalogResult> => {
    const attempt = async (query: CatalogQuery): Promise<CatalogResult> => {
      const url = baseUrl + buildCatalogUrl(query, { base: CATALOG_API_BASE, sfwOnly });
      try {
        const res = await deps.fetch(url);
        return toResult(res, false, deps.imageWidth);
      } catch (err) {
        return { kind: 'error', message: err instanceof Error ? err.message : 'network error' };
      }
    };
    const first = await attempt(q);
    // Empty family page → retry ONCE without the family filter (a generic page
    // beats a blank picker when the hint was an ecosystem key, not a name).
    if (first.kind === 'empty' && familyFilter) {
      return attempt({ ...q, baseModels: undefined });
    }
    return first;
  };

  // No token: public endpoint, advisory SFW.
  if (!token) return fetchPublic(anonSfwOnly);

  const fetchAuth = async (query: CatalogQuery): Promise<CatalogResult> => {
    const authUrl = baseUrl + buildCatalogUrl(query, { base: CATALOG_API_BASE_BLOCKS });
    let authRes: Awaited<ReturnType<typeof fetch>>;
    try {
      authRes = await deps.fetch(authUrl, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
      deps.onFallback?.({ reason: 'network' });
      return fetchPublic(true);
    }

    if (!authRes.ok && isFallbackStatus(authRes.status)) {
      deps.onFallback?.({ status: authRes.status });
      return fetchPublic(true);
    }

    return toResult(authRes, true, deps.imageWidth);
  };

  // With token: authoritative, server-maturity-clamped endpoint.
  const first = await fetchAuth(q);
  // Empty family page on the authoritative read → retry ONCE without the family
  // filter (still authoritative — never a degraded path just to drop the hint).
  if (first.kind === 'empty' && familyFilter) {
    return fetchAuth({ ...q, baseModels: undefined });
  }
  return first;
}
