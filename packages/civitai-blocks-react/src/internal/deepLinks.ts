/**
 * Deep-link helpers shared by the mock host and the dev:live host (HQ
 * app_blocks_sdk_j1gc): splitting an app-scoped NAVIGATE path into the
 * `{ subPath, search, hash }` the page host forwards, and building the canonical
 * SHARE_LINK URL.
 *
 * 🔴 NOT THE AUTHORITY. The page host (civitai/civitai `deepLinkLogic.ts` and the
 * NAVIGATE resolver it reuses) decides what is refused in production. These mirror
 * its outcomes for the cases an app author will hit — `..`, `//host`, a scheme, a
 * backslash, an encoded separator, a control character, an over-long field — so a
 * block tested here meets the same refusals there. The host's percent-encoded
 * dot-segment rules are approximated by decoding each segment once.
 */

/** Same cap as the page host's `BRIDGE_LOCATION_MAX_LENGTH`. */
export const DEEP_LINK_MAX_LENGTH = 2048;

/** The page host's refusal text for a share link that would leave the app. */
export const SHARE_LINK_INVALID_ERROR = 'invalid share link';

/** The page host's refusal for a second share inside the interval or while one is in flight. */
export const SHARE_LINK_RATE_LIMITED_ERROR = 'rate_limited';

/** What a host that cannot serve SHARE_LINK (a non-page slot) answers. */
export const SHARE_LINK_UNSUPPORTED_ERROR = 'unsupported on this host';

/** The page host's minimum gap between two admitted shares. */
export const SHARE_LINK_MIN_INTERVAL_MS = 1000;

/**
 * Query parameters the page host owns on a run URL (civitai/civitai
 * `HOST_OWNED_RUN_PARAMS`): stripped from every share URL, however the key is spelled.
 */
export const HOST_OWNED_RUN_PARAMS: readonly string[] = ['from', 'sl', 'src'];

function stripHostOwnedPairs(search: string): string {
  if (search === '' || search === '?') return '';
  const pairs = search
    .slice(1)
    .split('&')
    .filter((pair) => {
      if (pair === '') return false;
      const eq = pair.indexOf('=');
      const rawKey = (eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' ');
      try {
        return !HOST_OWNED_RUN_PARAMS.includes(decodeURIComponent(rawKey));
      } catch {
        return true;
      }
    });
  return pairs.length ? `?${pairs.join('&')}` : '';
}

/**
 * The page host's share limiter: one in flight, at most one per
 * {@link SHARE_LINK_MIN_INTERVAL_MS}. `admit()` false ⇒ reply {@link SHARE_LINK_RATE_LIMITED_ERROR}.
 */
export function createShareLinkLimiter(now: () => number = () => Date.now()) {
  let inFlight = false;
  let last = Number.NEGATIVE_INFINITY;
  return {
    admit(): boolean {
      const t = now();
      if (inFlight || t - last < SHARE_LINK_MIN_INTERVAL_MS) return false;
      inFlight = true;
      last = t;
      return true;
    },
    settle(): void {
      inFlight = false;
    },
  };
}

export interface AppLocation {
  subPath: string;
  search: string;
  hash: string;
}

function isHostile(raw: string): boolean {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return true;
  if (/^\/[/\\]/.test(raw)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/.test(raw)) return true;
  if (raw.includes('\\')) return true;
  if (/%(?:2f|5c)/i.test(raw)) return true;
  return false;
}

/** The app sub-path with leading and one trailing slash removed, or `null` when it escapes. */
function normaliseSubPath(raw: string): string | null {
  let path = raw.replace(/^\/+/, '');
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (path === '') return '';
  for (const seg of path.split('/')) {
    if (seg === '') return null;
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* a malformed escape cannot be a dot segment */
    }
    if (decoded === '.' || decoded === '..') return null;
  }
  return path;
}

/**
 * Split an app-scoped NAVIGATE `path` (which may carry `?query#hash`) into the
 * location the page host would forward, or `null` when the host would drop it.
 */
export function appLocationFromNavigatePath(rawPath: string): AppLocation | null {
  if (isHostile(rawPath)) return null;
  const hashAt = rawPath.indexOf('#');
  const beforeHash = hashAt < 0 ? rawPath : rawPath.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : rawPath.slice(hashAt);
  const queryAt = beforeHash.indexOf('?');
  const pathPart = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const search = queryAt < 0 ? '' : beforeHash.slice(queryAt);
  const subPath = normaliseSubPath(pathPart);
  if (subPath === null) return null;
  return {
    subPath,
    search: search === '?' || search.length > DEEP_LINK_MAX_LENGTH ? '' : search,
    hash: hash === '#' || hash.length > DEEP_LINK_MAX_LENGTH ? '' : hash,
  };
}

/**
 * The canonical share URL — `<origin>/apps/run/<slug>[/<subPath>]<search><hash>` — or
 * `null` when the page host would refuse the request with {@link SHARE_LINK_INVALID_ERROR}.
 */
export function buildShareLinkUrl(origin: string, slug: string, raw: unknown): string | null {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const field = (v: unknown): string | null => (v === undefined ? '' : typeof v === 'string' ? v : null);
  const subPath = field(p.subPath);
  const search = field(p.search);
  const hash = field(p.hash);
  if (subPath === null || search === null || hash === null) return null;
  if ([subPath, search, hash].some((v) => v.length > DEEP_LINK_MAX_LENGTH)) return null;
  if (/[?#]/.test(subPath)) return null;
  if (search !== '' && (!search.startsWith('?') || search.includes('#'))) return null;
  if (hash !== '' && !hash.startsWith('#')) return null;
  if (isHostile(`${subPath}${search}${hash}`)) return null;
  const sub = normaliseSubPath(subPath);
  if (sub === null) return null;
  const tail = `${stripHostOwnedPairs(search)}${hash === '#' ? '' : hash}`;
  return `${origin}/apps/run/${encodeURIComponent(slug)}${sub ? `/${sub}` : ''}${tail}`;
}
