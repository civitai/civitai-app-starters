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
   *
   * Must itself be a whole number in `[0, 2**31-1]`. `NaN` (the result of
   * `Number(undefined)` — easy to pass by accident from a half-populated
   * store), a negative, a fraction and anything past the ceiling are
   * **discarded in favour of `0`**, with a warning: an unchecked fallback is
   * the same silent-`NaN` defect this guard exists to close.
   *
   * On a *present but unreadable* `scope` this value can **over-state** the
   * grant — see {@link parseScope}. The over-statement is logged.
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
 * The one predicate for "is this a bitmask we can safely `&`/`|`". Both the
 * wire value and the caller-supplied `fallback` go through it — a fallback
 * checked by a *different* rule (or by none) is how #326 comes back through
 * the very option that was added to prevent it.
 */
function isUsableBitmask(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SCOPE_BITMASK;
}

/**
 * Resolve the caller's `fallback` into a bitmask that is safe to return.
 *
 * `fallback` is typed `number`, which admits `NaN`, `Infinity`, negatives and
 * values past the ceiling — and `?? ` does **not** catch any of them. A caller
 * writing `fallbackScope: Number(stored.scope)` against an absent
 * `stored.scope` passes `NaN`, so an unvalidated fallback puts `NaN` straight
 * into `tokens.scope` and every `hasScope()` answers `false`: #326 verbatim.
 *
 * An unusable fallback is therefore **discarded in favour of `0`**, with its
 * own warning. `0` is the same "no permissions" answer a caller who passed no
 * fallback at all gets; it is wrong in the safe direction (features stay
 * disabled) where `NaN` is wrong in a direction nothing downstream can detect,
 * and an over-ceiling value is wrong in the *unsafe* direction once `|` wraps
 * it negative. The warning fires on the absent-scope path too, which is
 * otherwise silent — the caller's own argument is a caller bug, not a server
 * quirk, so it is worth saying out loud.
 */
function usableFallback(fallback: number | undefined): number {
  if (fallback === undefined) return 0;
  if (!isUsableBitmask(fallback)) {
    console.warn(
      `[@civitai/app-sdk] \`fallbackScope\` is not a usable bitmask: ${String(fallback)}. ` +
        `Expected a whole number in [0, ${MAX_SCOPE_BITMASK}] (e.g. 114689). ` +
        `Discarding it and using 0 ("no permissions") instead.`,
    );
    return 0;
  }
  return fallback;
}

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
 * is not a whole number in `[0, 2**31-1]` is therefore rejected — including the
 * `fallback`, see {@link usableFallback}.
 *
 * The `typeof` check before `Number()` is load-bearing on its own: `Number()`
 * coerces a one-element array and a boolean into *valid-looking* bitmasks
 * (`Number(['65537'])` is `65537`, `Number(true)` is `1`, i.e.
 * `TokenScope.UserRead`), so without it a wrong-typed `scope` becomes a real,
 * wrong grant rather than a rejected one.
 *
 * **Rejected means fall back and warn, not throw.** #326 left that open
 * ("ignored *or* an error — say which"). A throw here turns a
 * degraded-but-working session into a hard login failure, and the callers that
 * could act on the distinction are exactly the ones already passing `fallback`
 * — a better answer than either `0` or an abort. The warning names the value
 * received so an unexpected wire format stays diagnosable.
 *
 * The two rejected-into-`fallback` paths are **not** equally sound, and the
 * difference is invisible at this seam:
 *
 * - An **absent** `scope` (`undefined`, `null`, or whitespace-only) is not a
 *   fault at all — RFC 6749 §5.1/§6 make it optional precisely when the grant
 *   *matches the request*, so the requested scope IS the granted scope and
 *   `fallback` is exactly right. This path is silent.
 * - A **present but unreadable** `scope` carries no such guarantee. The server
 *   is saying something about the grant that this SDK cannot read, and it may
 *   be a *reduced* grant. Falling back to the requested scope can therefore
 *   **over-state** what the user granted — every starter renders
 *   `scopesFromBitmask(tokens.scope)` to the user as "Granted scopes". #326
 *   weighed that against `0` and against throwing and chose fallback ("more
 *   honest than 0"), which is why this path warns: the over-statement is a
 *   known, logged trade, not an invariant.
 */
function parseScope(raw: unknown, fallback?: number): number {
  if (raw === undefined || raw === null) return usableFallback(fallback);
  if (typeof raw === 'string' && raw.trim() === '') return usableFallback(fallback);

  const value = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (!isUsableBitmask(value)) {
    const resolved = usableFallback(fallback);
    console.warn(
      `[@civitai/app-sdk] OAuth token response has an unusable \`scope\`: ${JSON.stringify(raw)}. ` +
        `Expected a decimal bitmask in [0, ${MAX_SCOPE_BITMASK}] (e.g. "114689"). ` +
        `Falling back to ${resolved}.`,
    );
    return resolved;
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
