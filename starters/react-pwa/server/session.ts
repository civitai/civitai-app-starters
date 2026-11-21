import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sealCookie, unsealCookie, type OAuthTokens } from '@civitai/app-sdk';
import { env } from './env.js';
import {
  forgetRefreshesFor,
  isDefiniteRejection,
  refreshTokensOnce,
  SessionEndedError,
} from './refresh-tokens.js';

const SESSION_COOKIE = 'civ_session';
const OAUTH_STATE_COOKIE = 'civ_oauth_state';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

export interface Session {
  tokens: OAuthTokens;
  user?: { id?: number; username?: string };
}

export interface OAuthStateCookie {
  state: string;
  verifier: string;
  scope: number;
}

const cookieOpts = (production: boolean) =>
  ({
    path: '/',
    httpOnly: true,
    secure: production,
    sameSite: 'Lax' as const,
  });

/**
 * Unseal + parse the session cookie. `null` for absent, tampered or malformed.
 *
 * The cookie AS STORED: no expiry check and no refresh. The revoke route reads
 * the tokens it sends upstream from here, not from `readSession()`, which
 * answers `null` whenever a refresh fails without `invalid_grant` (a 503, a
 * timeout): reading those tokens through it skipped the upstream revoke while
 * the cookie was still cleared, leaving a live refresh token at Civitai.
 */
export function parseSession(c: Context): Session | null {
  const sealed = getCookie(c, SESSION_COOKIE);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, env.SESSION_SECRET);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session?.tokens?.access_token ? session : null;
  } catch {
    return null;
  }
}

/**
 * The session for this request, refreshing an expiring access token in place.
 *
 * 🔴 ONLY `invalid_grant` SIGNS THE USER OUT. A refresh that fails any other
 * way (a 5xx, a 429, a network error, a refused client secret) returns `null`
 * for THIS request but leaves the browser's cookie alone, so the next request
 * tries again. Clearing on those turned a blip at the auth service into a
 * forced sign-in (#855). Which failures count is decided in one place,
 * `isDefiniteRejection` in `server/refresh-tokens.ts`.
 *
 * The refresh goes through `refreshTokensOnce`: the SPA's concurrent requests
 * with one cookie share one call to the token endpoint, and a straggler with
 * the old cookie reuses the rotation for 60 s instead of replaying a spent
 * refresh token (#804). That is per server process.
 */
export async function readSession(c: Context, production: boolean): Promise<Session | null> {
  const session = parseSession(c);
  if (!session) return null;

  if (session.tokens.expires_at > Date.now() + 30_000) return session;

  if (!session.tokens.refresh_token) return null;
  try {
    const fresh = await refreshTokensOnce({
      baseUrl: env.CIVITAI_AUTH_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
      // The refreshed blob REPLACES the stored one below, so a `scope` the
      // server omits (RFC 6749 §6 permits it) would be persisted as 0 and
      // lock the user out of features their token still grants.
      fallbackScope: session.tokens.scope,
    });
    const next: Session = { ...session, tokens: fresh };
    writeSession(c, next, production);
    return next;
  } catch (err) {
    if (!isDefiniteRejection(err)) {
      // Not a verdict on the refresh token: keep the cookie for a retry.
      // A sign-out ended the session while this request waited on its
      // refresh: nothing is retried, so this is not a failed refresh.
      if (!(err instanceof SessionEndedError)) {
        console.warn(
          '[session] refresh failed without rejecting the refresh token; keeping the cookie for a retry:',
          err instanceof Error ? err.message : err,
        );
      }
      return null;
    }
    // `invalid_grant`: the refresh token is unknown, expired, revoked or spent.
    deleteCookie(c, SESSION_COOKIE, cookieOpts(production));
    return null;
  }
}

export function writeSession(c: Context, session: Session, production: boolean): void {
  const sealed = sealCookie(JSON.stringify(session), env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, sealed, {
    ...cookieOpts(production),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Sign out: forget this session's remembered refreshes, then clear the cookie.
 * Without the first half, a request carrying the pre-rotation cookie inside the
 * 60 s reuse window would be handed this session's tokens again.
 *
 * Pass `{ revokeOrphans: true }` from the revoke route only: a refresh of this
 * session that is still in flight and then succeeds has its new refresh token
 * revoked upstream too (see `forgetRefreshesFor`). A plain sign-out leaves the
 * upstream tokens alone.
 */
export function clearSession(
  c: Context,
  production: boolean,
  { revokeOrphans = false }: { revokeOrphans?: boolean } = {},
): void {
  forgetRefreshesFor(parseSession(c)?.tokens, { revokeOrphans });
  deleteCookie(c, SESSION_COOKIE, cookieOpts(production));
}

export function writeOAuthState(
  c: Context,
  payload: OAuthStateCookie,
  production: boolean,
): void {
  const sealed = sealCookie(JSON.stringify(payload), env.SESSION_SECRET);
  setCookie(c, OAUTH_STATE_COOKIE, sealed, {
    ...cookieOpts(production),
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function consumeOAuthState(c: Context, production: boolean): OAuthStateCookie | null {
  const sealed = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, cookieOpts(production));
  if (!sealed) return null;
  const raw = unsealCookie(sealed, env.SESSION_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
