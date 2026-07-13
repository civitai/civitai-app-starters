import type { Cookies } from '@sveltejs/kit';
import {
  refreshToken as oauthRefresh,
  sealCookie,
  unsealCookie,
  type OAuthTokens,
} from '@civitai/app-sdk';
import { config } from './env';

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

export async function readSession(cookies: Cookies, production: boolean): Promise<Session | null> {
  const sealed = cookies.get(SESSION_COOKIE);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, config.SESSION_SECRET);
  if (!raw) return null;

  let session: Session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }

  if (session.tokens.expires_at > Date.now() + 30_000) return session;

  if (!session.tokens.refresh_token) return null;
  try {
    const fresh = await oauthRefresh({
      baseUrl: config.CIVITAI_AUTH_URL,
      clientId: config.CIVITAI_CLIENT_ID,
      clientSecret: config.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
    });
    const next: Session = { ...session, tokens: fresh };
    writeSession(cookies, next, production);
    return next;
  } catch {
    clearSession(cookies, production);
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

export function clearSession(cookies: Cookies, production: boolean): void {
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
