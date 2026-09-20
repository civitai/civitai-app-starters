import type { OAuthTokenResponse, OAuthTokens } from '../types.js';
import { TokenScope } from '../scopes/index.js';

// OAuth endpoints (token/revoke) live on the standalone auth hub.
const DEFAULT_AUTH_BASE_URL = 'https://auth.civitai.com';
// /api/v1/me and the buzz tRPC surface live on the main app.
const DEFAULT_API_BASE_URL = 'https://civitai.com';

interface CommonOpts {
  baseUrl?: string;
  clientId: string;
  /** Only required for confidential clients. Public clients omit this. */
  clientSecret?: string;
}

/** Mixed into the grants that return tokens (not into revoke). */
interface ScopeFallbackOpts {
  /**
   * Bitmask to use when the token response omits `scope` entirely. RFC 6749
   * §5.1/§6 let the server omit `scope` when the grant is identical to what
   * was requested, so pass the scope you asked for (`REQUESTED_SCOPES` on
   * exchange, the previously granted `tokens.scope` on refresh). Without it an
   * omitted `scope` resolves to `0`, i.e. "no permissions".
   *
   * This is only consulted when `scope` is absent — a `scope` the server *did*
   * send but this SDK cannot parse throws {@link OAuthScopeError} instead of
   * silently falling back.
   */
  fallbackScope?: number;
}

export interface ExchangeCodeOpts extends CommonOpts, ScopeFallbackOpts {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface RefreshTokenOpts extends CommonOpts, ScopeFallbackOpts {
  refreshToken: string;
}

export interface RevokeTokenOpts extends CommonOpts {
  token: string;
}

export class OAuthError extends Error {
  // Typed `string`, not the literal `'OAuthError'`, so subclasses such as
  // {@link OAuthScopeError} can narrow it. Base instances still read
  // `'OAuthError'` at runtime.
  override readonly name: string = 'OAuthError';
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function postForm(
  url: string,
  body: Record<string, string | undefined>,
): Promise<unknown> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) params.set(k, v);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new OAuthError(
      `OAuth request failed: ${res.status} ${res.statusText}`,
      res.status,
      parsed,
    );
  }
  return parsed;
}

/**
 * Thrown when a token response carries a `scope` this SDK cannot turn into a
 * bitmask. Extends {@link OAuthError} so existing `catch (e) { if (e
 * instanceof OAuthError) … }` blocks around {@link exchangeCode} /
 * {@link refreshToken} keep working. `status` is the HTTP status of the token
 * response itself (the request succeeded; only the payload was unusable).
 */
export class OAuthScopeError extends OAuthError {
  override readonly name = 'OAuthScopeError';
  /** The raw `scope` value as received from the authorization server. */
  readonly received: unknown;
  constructor(received: unknown, detail: string, status = 200) {
    super(
      `OAuth token response has an unparseable \`scope\`: ${JSON.stringify(received) ?? String(received)} (${detail}). ` +
        'Expected a decimal bitmask (e.g. 114689 or "114689"), or a space-delimited ' +
        'list of scope names or decimal values (e.g. "UserRead BuzzRead").',
      status,
      received,
    );
    this.received = received;
  }
}

/**
 * Largest value this SDK will accept as a scope bitmask. Scopes are combined
 * with `|`, which is a 32-bit *signed* operation in JS — anything at or above
 * 2**31 would wrap negative and silently corrupt every later `hasScope` check.
 * `TokenScope.Full` is 2**25-1, so this leaves six bits of headroom.
 */
const MAX_SCOPE_BITMASK = 2 ** 31 - 1;

/** Exact-name lookup for every `TokenScope` key (`None` and `Full` included). */
const SCOPE_BY_NAME = new Map<string, number>(
  Object.entries(TokenScope).map(([name, bit]) => [name, bit as number]),
);

function assertUsableBitmask(value: number, received: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SCOPE_BITMASK) {
    throw new OAuthScopeError(
      received,
      `${what} is not a non-negative integer <= ${MAX_SCOPE_BITMASK}`,
    );
  }
  return value;
}

/**
 * Turn an OAuth token response's `scope` into a {@link TokenScope} bitmask.
 *
 * Civitai's authorization server sends a **decimal integer bitmask as a JSON
 * string** (`"scope": "114689"` — see
 * https://developer.civitai.com/site/oauth/endpoints), matching the decimal
 * `scope` that {@link buildAuthorizeUrl} puts on the authorize URL. RFC 6749
 * §5.1 instead defines `scope` as a space-delimited list, so this parser
 * accepts both shapes and every mixture of them:
 *
 * - a JSON number — `114689`
 * - a decimal string — `"114689"`
 * - space-delimited scope names — `"UserRead BuzzRead AIServicesWrite"`
 * - space-delimited decimal values — `"1 65536 32768"`
 * - any mixture — `"UserRead 65536"`
 *
 * It never returns `NaN` and never silently degrades to `0`: a value it cannot
 * understand — an unknown scope name, a negative or fractional number, a
 * non-string/non-number type — throws {@link OAuthScopeError} naming the value
 * received. On an auth path a loud failure beats handing the caller a bitmask
 * that quietly claims the user granted nothing.
 *
 * An **absent** `scope` (`undefined` or `null`) is not an error. RFC 6749 §5.1
 * and §6 make `scope` optional precisely when the grant is identical to what
 * was requested, so this returns `fallback` — pass the scope you asked for.
 * With no `fallback`, it returns `0`.
 *
 * @example
 * parseScope('114689');                    // 114689
 * parseScope('UserRead BuzzRead');         // 65537
 * parseScope(undefined, REQUESTED_SCOPES); // REQUESTED_SCOPES
 * parseScope('UserRead Nonsense');         // throws OAuthScopeError
 */
export function parseScope(raw: unknown, fallback?: number): number {
  // Absent: not an error — this is what `fallback` is for.
  if (raw === undefined || raw === null) return fallback ?? 0;

  if (typeof raw === 'number') {
    return assertUsableBitmask(raw, raw, 'scope');
  }

  if (typeof raw !== 'string') {
    throw new OAuthScopeError(raw, `scope is a ${typeof raw}, expected a string or a number`);
  }

  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  // An empty/whitespace-only string carries no grant information; treat it the
  // same as an omitted scope rather than asserting "you were granted nothing".
  if (tokens.length === 0) return fallback ?? 0;

  let mask = 0;
  for (const token of tokens) {
    const named = SCOPE_BY_NAME.get(token);
    if (named !== undefined) {
      mask |= named;
      continue;
    }
    if (!/^\d+$/.test(token)) {
      throw new OAuthScopeError(raw, `"${token}" is not a known scope name or a decimal value`);
    }
    mask |= assertUsableBitmask(Number(token), raw, `"${token}"`);
  }
  return assertUsableBitmask(mask, raw, 'the combined scope');
}

function shapeTokens(json: OAuthTokenResponse, fallbackScope?: number): OAuthTokens {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: parseScope(json.scope, fallbackScope),
    token_type: json.token_type ?? 'Bearer',
  };
}

/**
 * Exchange an authorization code for tokens (PKCE flow). Call this in your
 * `redirect_uri` callback handler with the `code` from the query string and the
 * `codeVerifier` you stashed when starting the flow. Omit `clientSecret` for
 * public clients. Throws {@link OAuthError} on a non-2xx token response, or
 * {@link OAuthScopeError} if the response's `scope` cannot be parsed (see
 * {@link parseScope}). Pass `fallbackScope` so an *omitted* `scope` resolves to
 * what you requested rather than to `0`.
 *
 * @example
 * const tokens = await exchangeCode({
 *   clientId: process.env.CIVITAI_CLIENT_ID!,
 *   clientSecret: process.env.CIVITAI_CLIENT_SECRET, // omit for public clients
 *   redirectUri: 'https://your-app.com/api/auth/callback/civitai',
 *   code: codeFromQuery,
 *   codeVerifier: verifierFromSealedCookie,
 *   fallbackScope: REQUESTED_SCOPES,
 * });
 */
export async function exchangeCode(opts: ExchangeCodeOpts): Promise<OAuthTokens> {
  const base = opts.baseUrl ?? DEFAULT_AUTH_BASE_URL;
  const json = (await postForm(`${base}/api/auth/oauth/token`, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.codeVerifier,
  })) as OAuthTokenResponse;
  return shapeTokens(json, opts.fallbackScope);
}

/**
 * Refresh an access token using a refresh_token grant. Returns a fresh
 * {@link OAuthTokens} (with a recomputed `expires_at`). Throws
 * {@link OAuthError} on failure — treat that as "re-authenticate."
 *
 * Pass `fallbackScope: stored.scope`: RFC 6749 §6 lets the server omit `scope`
 * when the refreshed grant is unchanged, and callers that replace the whole
 * token blob (`{ ...session, tokens: fresh }`) would otherwise persist a `0`
 * scope and lock the user out of their own features.
 *
 * @example
 * const tokens = await refreshToken({
 *   clientId: process.env.CIVITAI_CLIENT_ID!,
 *   clientSecret: process.env.CIVITAI_CLIENT_SECRET, // omit for public clients
 *   refreshToken: stored.refresh_token,
 *   fallbackScope: stored.scope,
 * });
 */
export async function refreshToken(opts: RefreshTokenOpts): Promise<OAuthTokens> {
  const base = opts.baseUrl ?? DEFAULT_AUTH_BASE_URL;
  const json = (await postForm(`${base}/api/auth/oauth/token`, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  })) as OAuthTokenResponse;
  return shapeTokens(json, opts.fallbackScope);
}

/**
 * Revoke an access or refresh token (e.g. on logout). Omit `clientSecret` for
 * public clients. Throws {@link OAuthError} on a non-2xx response.
 *
 * @example
 * await revokeToken({
 *   clientId: process.env.CIVITAI_CLIENT_ID!,
 *   token: tokens.refresh_token,
 * });
 */
export async function revokeToken(opts: RevokeTokenOpts): Promise<void> {
  const base = opts.baseUrl ?? DEFAULT_AUTH_BASE_URL;
  await postForm(`${base}/api/auth/oauth/revoke`, {
    token: opts.token,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
}

/**
 * Fetch the OAuth-authenticated user's profile via `/api/v1/me`. Does NOT
 * include Buzz balance — use {@link fetchBuzzAccount} (needs `BuzzRead`) for
 * that. Throws {@link OAuthError} on a non-2xx response.
 *
 * @example
 * const me = await fetchMe({ accessToken: tokens.access_token });
 */
export async function fetchMe(opts: { baseUrl?: string; accessToken: string }): Promise<unknown> {
  const base = opts.baseUrl ?? DEFAULT_API_BASE_URL;
  const res = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) {
    throw new OAuthError(`/api/v1/me failed: ${res.status}`, res.status, await res.text());
  }
  return res.json();
}

/** Buzz currency pools tracked per user account. */
export type BuzzAccountType = 'yellow' | 'blue' | 'red' | 'green' | 'purple';

export interface BuzzAccount {
  /** The user's Civitai account id. */
  id: number;
  /** Current spendable balance in this pool. */
  balance: number;
  /** Lifetime credited buzz in this pool (null when unavailable). */
  lifetimeBalance: number | null;
  /** Which buzz pool this balance belongs to. */
  accountType: BuzzAccountType;
}

export interface FetchBuzzAccountOpts {
  baseUrl?: string;
  accessToken: string;
}

/**
 * Fetch the OAuth-authenticated user's Buzz account(s).
 *
 * Civitai's `/api/v1/me` does NOT include balance. Balance lives behind the
 * `buzz.getUserAccount` tRPC procedure which requires the `BuzzRead` scope.
 * Returns one entry per buzz pool — typically just `yellow` for end users.
 *
 * NOTE: this hits Civitai's tRPC surface directly because no REST endpoint
 * exists yet. If/when Civitai exposes one, switch this helper over without
 * breaking callers.
 */
export async function fetchBuzzAccount(opts: FetchBuzzAccountOpts): Promise<BuzzAccount[]> {
  const base = opts.baseUrl ?? DEFAULT_API_BASE_URL;
  const res = await fetch(`${base}/api/trpc/buzz.getUserAccount`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) {
    throw new OAuthError(
      `buzz.getUserAccount failed: ${res.status}`,
      res.status,
      await res.text(),
    );
  }
  // Civitai's tRPC uses a superjson transformer, so the payload is
  // `{ result: { data: { json: T } } }`. Older or transformer-less routes
  // return `{ result: { data: T } }` directly — handle both defensively.
  const json = (await res.json()) as {
    result?: { data?: BuzzAccount[] | { json?: BuzzAccount[] } };
  };
  const data = json.result?.data;
  if (Array.isArray(data)) return data;
  return data?.json ?? [];
}
