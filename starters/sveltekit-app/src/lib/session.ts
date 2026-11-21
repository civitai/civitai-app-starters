import type { Cookies } from '@sveltejs/kit';
import { sealCookie, unsealCookie, type OAuthTokens } from '@civitai/app-sdk';
import { config } from './env';
import {
  forgetRefreshesFor,
  isDefiniteRejection,
  refreshTokensOnce,
  SessionEndedError,
} from './refresh-tokens';

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

const sessionCookieOpts = (production: boolean) =>
  ({
    path: '/',
    httpOnly: true,
    secure: production,
    sameSite: 'lax' as const,
  });

/**
 * The sign-out routes. `hooks.server.ts` does not refresh for them: they end
 * the session, so a refresh there would mint tokens only to throw them away,
 * and a sign-out from a second tab would WAIT on the refresh the first tab has
 * in flight, the one the sign-out is about to end. They read the stored
 * cookie instead ({@link parseSession}).
 */
export const SIGN_OUT_PATHS: ReadonlySet<string> = new Set(['/api/auth/logout', '/api/auth/revoke']);

/**
 * Unseal + parse the session cookie. `null` for absent, tampered or malformed.
 *
 * The cookie AS STORED: no expiry check and no refresh. The revoke route reads
 * the tokens it sends upstream from here, not from `locals.session`, which is
 * `null` whenever a refresh fails without `invalid_grant` (a 503, a timeout):
 * reading those tokens from it skipped the upstream revoke while the cookie
 * was still cleared, leaving a live refresh token at Civitai.
 */
export function parseSession(cookies: Cookies): Session | null {
  const sealed = cookies.get(SESSION_COOKIE);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, config.SESSION_SECRET);
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
 * Called once per request from `hooks.server.ts`, where cookie writes are
 * allowed.
 *
 * 🔴 ONLY `invalid_grant` SIGNS THE USER OUT. A refresh that fails any other
 * way (a 5xx, a 429, a network error, a refused client secret) returns `null`
 * for THIS request but leaves the browser's cookie alone, so the next request
 * tries again. Clearing on those turned a blip at the auth service into a
 * forced sign-in (#855). Which failures count is decided in one place,
 * `isDefiniteRejection` in `src/lib/refresh-tokens.ts`.
 *
 * The refresh goes through `refreshTokensOnce`: concurrent requests with one
 * cookie share one call to the token endpoint, and a straggler with the old
 * cookie reuses the rotation for 60 s instead of replaying a spent refresh
 * token (#804). That is per server process.
 */
export async function readSession(cookies: Cookies, production: boolean): Promise<Session | null> {
  const session = parseSession(cookies);
  if (!session) return null;

  if (session.tokens.expires_at > Date.now() + 30_000) return session;

  if (!session.tokens.refresh_token) return null;
  try {
    const fresh = await refreshTokensOnce({
      baseUrl: config.CIVITAI_AUTH_URL,
      clientId: config.CIVITAI_CLIENT_ID,
      clientSecret: config.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
      // The refreshed blob REPLACES the stored one below, so a `scope` the
      // server omits (RFC 6749 §6 permits it) would be persisted as 0 and
      // lock the user out of features their token still grants.
      fallbackScope: session.tokens.scope,
    });
    const next: Session = { ...session, tokens: fresh };
    writeSession(cookies, next, production);
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
    cookies.delete(SESSION_COOKIE, sessionCookieOpts(production));
    return null;
  }
}

export function writeSession(cookies: Cookies, session: Session, production: boolean): void {
  const sealed = sealCookie(JSON.stringify(session), config.SESSION_SECRET);
  cookies.set(SESSION_COOKIE, sealed, {
    ...sessionCookieOpts(production),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Sign out: forget this session's remembered refreshes, then clear the cookie.
 * Without the first half, a request carrying the pre-rotation cookie inside the
 * 60 s reuse window would be handed this session's tokens again.
 */
export function clearSession(cookies: Cookies, production: boolean): void {
  forgetRefreshesFor(parseSession(cookies)?.tokens);
  cookies.delete(SESSION_COOKIE, sessionCookieOpts(production));
}

export function writeOAuthState(
  cookies: Cookies,
  payload: OAuthStateCookie,
  production: boolean,
): void {
  const sealed = sealCookie(JSON.stringify(payload), config.SESSION_SECRET);
  cookies.set(OAUTH_STATE_COOKIE, sealed, {
    ...sessionCookieOpts(production),
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
}

export function consumeOAuthState(
  cookies: Cookies,
  production: boolean,
): OAuthStateCookie | null {
  const sealed = cookies.get(OAUTH_STATE_COOKIE);
  cookies.delete(OAUTH_STATE_COOKIE, sessionCookieOpts(production));
  if (!sealed) return null;
  const raw = unsealCookie(sealed, config.SESSION_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
