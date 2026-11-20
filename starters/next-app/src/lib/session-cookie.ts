/**
 * Session-cookie shape and pure helpers.
 *
 * Deliberately split out of `session.ts`: that module imports `server-only` and
 * `next/headers`, neither of which belongs in middleware. Everything here is a
 * pure function of its arguments — no cookie jar, no request, no I/O — so both
 * the Server-Component reader and the middleware writer can share one
 * definition of what a session cookie IS. One rule, one place.
 */
import { unsealCookie } from '@civitai/app-sdk';
import type { OAuthTokens } from '@civitai/app-sdk';

export const SESSION_COOKIE = 'civ_session';
export const OAUTH_STATE_COOKIE = 'civ_oauth_state';

/** 30 days — bound by the refresh-token TTL on Civitai. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
export const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;

/**
 * Refresh this long before the access token actually expires, so a request that
 * arrives just inside the window still gets a token that outlives its own
 * round-trip.
 */
export const REFRESH_SKEW_MS = 30_000;

export interface Session {
  tokens: OAuthTokens;
  /** Cached user info from /api/v1/me — refreshed lazily. */
  user?: { id?: number; username?: string };
}

export interface OAuthStateCookie {
  state: string;
  verifier: string;
  scope: number;
}

/** Unseal + parse. `null` for absent, tampered, wrong-secret or malformed. */
export function parseSession(
  sealed: string | undefined | null,
  secret: string,
): Session | null {
  if (!sealed) return null;
  const raw = unsealCookie(sealed, secret);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.tokens?.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** `true` when the access token is expired or close enough to count as expired. */
export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.tokens.expires_at <= now + REFRESH_SKEW_MS;
}
