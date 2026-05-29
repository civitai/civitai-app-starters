import type { OAuthTokenResponse, OAuthTokens } from '../types.js';

const DEFAULT_CIVITAI_BASE_URL = 'https://civitai.com';

interface CommonOpts {
  baseUrl?: string;
  clientId: string;
  /** Only required for confidential clients. Public clients omit this. */
  clientSecret?: string;
}

export interface ExchangeCodeOpts extends CommonOpts {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface RefreshTokenOpts extends CommonOpts {
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

function shapeTokens(json: OAuthTokenResponse, fallbackScope?: number): OAuthTokens {
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: typeof json.scope === 'number' ? json.scope : Number(json.scope ?? fallbackScope ?? 0),
    token_type: json.token_type ?? 'Bearer',
  };
}

/** Exchange an authorization code for tokens (PKCE flow). */
export async function exchangeCode(opts: ExchangeCodeOpts): Promise<OAuthTokens> {
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
  const json = (await postForm(`${base}/api/auth/oauth/token`, {
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code_verifier: opts.codeVerifier,
  })) as OAuthTokenResponse;
  return shapeTokens(json);
}

/** Refresh an access token using a refresh_token grant. */
export async function refreshToken(opts: RefreshTokenOpts): Promise<OAuthTokens> {
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
  const json = (await postForm(`${base}/api/auth/oauth/token`, {
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  })) as OAuthTokenResponse;
  return shapeTokens(json);
}

/** Revoke an access or refresh token. */
export async function revokeToken(opts: RevokeTokenOpts): Promise<void> {
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
  await postForm(`${base}/api/auth/oauth/revoke`, {
    token: opts.token,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });
}

/** Fetch the OAuth-authenticated user's profile via `/api/v1/me`. */
export async function fetchMe(opts: { baseUrl?: string; accessToken: string }): Promise<unknown> {
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
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
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
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
  const json = (await res.json()) as { result?: { data?: BuzzAccount[] } };
  return json.result?.data ?? [];
}
