import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  refreshToken as oauthRefresh,
  sealCookie,
  unsealCookie,
  type OAuthTokens,
} from '@civitai/app-sdk';
import { env } from './env.js';

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

export async function readSession(c: Context, production: boolean): Promise<Session | null> {
  const sealed = getCookie(c, SESSION_COOKIE);
  if (!sealed) return null;
  const raw = unsealCookie(sealed, env.SESSION_SECRET);
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
      baseUrl: env.CIVITAI_AUTH_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      refreshToken: session.tokens.refresh_token,
    });
    const next: Session = { ...session, tokens: fresh };
    writeSession(c, next, production);
    return next;
  } catch {
    clearSession(c, production);
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

export function clearSession(c: Context, production: boolean): void {
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
