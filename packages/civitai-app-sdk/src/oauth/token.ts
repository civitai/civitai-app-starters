import type { OAuthTokenResponse, OAuthTokens } from '../types.js';

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
   * Bitmask to use when the token response's `scope` is absent or unusable.
   * RFC 6749 §5.1/§6 let the server omit `scope` when the grant is identical
   * to what was requested, so pass the scope you asked for
   * (`REQUESTED_SCOPES` on exchange, the previously granted `tokens.scope` on
   * refresh). Without it, an absent or unusable `scope` resolves to `0`, i.e.
   * "no permissions".
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
  override readonly name = 'OAuthError';
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
 * Largest value accepted as a scope bitmask. Scopes are combined and tested
 * with `&`/`|`, which are 32-bit *signed* operations in JS — anything at or
 * above 2**31 wraps negative and silently corrupts every later `hasScope`
 * check. `TokenScope.Full` is 2**25-1, so this leaves six bits of headroom.
 */
const MAX_SCOPE_BITMASK = 2 ** 31 - 1;

/**
 * Coerce a token response's `scope` into a usable bitmask.
 *
 * Civitai sends a decimal bitmask as a JSON string (`"scope": "114689"` — see
 * https://developer.civitai.com/site/oauth/endpoints), so `Number()` is the
 * right coercion; what was missing is a guard on its RESULT. RFC 6749 §5.1
 * defines `scope` as a space-delimited *list*, and
 * `Number('ai:write:budgeted user:read:self')` is `NaN`. `NaN & anything` is
 * `0`, so every `hasScope()` answered `false` and a user who had just consented
 * was told they granted nothing, with no error anywhere (#326). Anything that
 * is not a whole number in `[0, 2**31-1]` is therefore rejected.
 *
 * **Rejected means fall back and warn, not throw.** #326 left that open
 * ("ignored *or* an error — say which"). A throw here turns a
 * degraded-but-working session into a hard login failure, and the callers that
 * could act on the distinction are exactly the ones already passing `fallback`
 * — a better answer than either `0` or an abort. The warning names the value
 * received so an unexpected wire format stays diagnosable.
 *
 * An **absent** `scope` (`undefined`, `null`, or whitespace-only) is not a
 * fault at all — RFC 6749 §5.1/§6 make it optional when the grant matches the
 * request — so it resolves to `fallback` silently.
 */
function parseScope(raw: unknown, fallback?: number): number {
  if (raw === undefined || raw === null) return fallback ?? 0;
  if (typeof raw === 'string' && raw.trim() === '') return fallback ?? 0;

  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SCOPE_BITMASK) {
    console.warn(
      `[@civitai/app-sdk] OAuth token response has an unusable \`scope\`: ${JSON.stringify(raw)}. ` +
        `Expected a decimal bitmask in [0, ${MAX_SCOPE_BITMASK}] (e.g. "114689"). ` +
        `Falling back to ${fallback ?? 0}.`,
    );
    return fallback ?? 0;
  }
  return value;
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
 * public clients. Throws {@link OAuthError} on a non-2xx token response. Pass
 * `fallbackScope` so a `scope` the server omits — or one this SDK cannot read
 * as a bitmask — resolves to what you requested rather than to `0`.
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
 * scope and lock the user out of their own features. The same value is used if
 * the server sends a `scope` this SDK cannot read as a bitmask.
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
