import { cookies } from 'next/headers';
import {
  buildSetCookieHeader,
  refreshToken as oauthRefresh,
  sealCookie,
  unsealCookie,
  type OAuthTokens,
} from '@civitai/app-sdk';
import 'server-only';
import { env } from './env';

const SESSION_COOKIE = 'civ_session';
const OAUTH_STATE_COOKIE = 'civ_oauth_state';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — bound by refresh-token TTL on Civitai
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

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

/**
 * Load the current session from the sealed cookie. Returns null if not logged
 * in or if the cookie failed to decrypt (tampered / wrong secret / expired).
 *
 * If the access token is past expiry but a refresh token is present, this
 * function automatically refreshes and writes the new session back.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const sealed = jar.get(SESSION_COOKIE)?.value;
  if (!sealed) return null;

  const raw = unsealCookie(sealed, env.SESSION_SECRET);
  if (!raw) return null;

  let session: Session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }

  // Token still valid? Done.
  if (session.tokens.expires_at > Date.now() + 30_000) return session;

  // Try to refresh.
  if (!session.tokens.refresh_token) return null;
  try {
    const fresh = await oauthRefresh({
      baseUrl: env.CIVITAI_BASE_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
    });
    const next: Session = { ...session, tokens: fresh };
    await setSession(next);
    return next;
  } catch {
    await clearSession();
    return null;
  }
}

/** Shared cookie attrs — httpOnly + lax + secure-in-prod for every cookie we set. */
async function writeCookie(name: string, value: string, maxAge: number): Promise<void> {
  const jar = await cookies();
  jar.set({
    name,
    value,
    maxAge,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
}

export async function setSession(session: Session): Promise<void> {
  const sealed = sealCookie(JSON.stringify(session), env.SESSION_SECRET);
  await writeCookie(SESSION_COOKIE, sealed, SESSION_MAX_AGE_SECONDS);
}

export async function clearSession(): Promise<void> {
  await writeCookie(SESSION_COOKIE, '', 0);
}

export async function setOAuthState(payload: OAuthStateCookie): Promise<void> {
  const sealed = sealCookie(JSON.stringify(payload), env.SESSION_SECRET);
  await writeCookie(OAUTH_STATE_COOKIE, sealed, OAUTH_STATE_MAX_AGE_SECONDS);
}

export async function consumeOAuthState(): Promise<OAuthStateCookie | null> {
  const jar = await cookies();
  const sealed = jar.get(OAUTH_STATE_COOKIE)?.value;
  await writeCookie(OAUTH_STATE_COOKIE, '', 0);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, env.SESSION_SECRET);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Re-export for routes that need to construct Set-Cookie headers directly. */
export { buildSetCookieHeader };
