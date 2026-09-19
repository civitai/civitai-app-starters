import { cookies } from 'next/headers';
import { buildSetCookieHeader, sealCookie, unsealCookie } from '@civitai/app-sdk';
import 'server-only';
import { env } from './env';
import {
  needsRefresh,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  parseSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type OAuthStateCookie,
  type Session,
} from './session-cookie';

export type { Session, OAuthStateCookie };

/**
 * Load the current session from the sealed cookie. Returns `null` if not logged
 * in, if the cookie failed to decrypt (tampered / wrong secret), or if the
 * access token is past expiry.
 *
 * 🔴 READ-ONLY. THIS FUNCTION MUST NEVER WRITE A COOKIE, because its primary
 * caller is a Server Component and Next.js forbids cookie writes there. It used
 * to refresh in place — `await setSession(next)` on success, `await
 * clearSession()` on failure — and BOTH arms called `cookies().set()`, so an
 * expired session made the render throw:
 *
 *     Error: Cookies can only be modified in a Server Action or Route Handler.
 *
 * Measured against `main` @ 0b6055b with `scripts/probe-expired-session.mjs`:
 * the page came back 200 with a permanently-stuck loading skeleton, no
 * logged-out UI, and zero `Set-Cookie` headers — so the dead cookie was re-sent
 * on every subsequent request and the failed refresh was paid again each time.
 * The `catch` arm is the nastier half: it converts a recoverable "your session
 * ended" into an unrecoverable render error.
 *
 * Refresh now happens in `src/middleware.ts`, which runs before the render and
 * IS allowed to write cookies. By the time this function runs, the request's
 * cookie is either already refreshed or already gone.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = parseSession(jar.get(SESSION_COOKIE)?.value, env.SESSION_SECRET);
  if (!session) return null;
  // Middleware should have refreshed or cleared this already; if it somehow did
  // not (a path outside the matcher), treat an expired token as logged out
  // rather than writing from a render.
  if (needsRefresh(session)) return null;
  return session;
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

/**
 * Write the session cookie. Route Handlers and Server Actions only — a Server
 * Component calling this throws. `getSession()` deliberately does not.
 */
export async function setSession(session: Session): Promise<void> {
  const sealed = sealCookie(JSON.stringify(session), env.SESSION_SECRET);
  await writeCookie(SESSION_COOKIE, sealed, SESSION_MAX_AGE_SECONDS);
}

/** Clear the session cookie. Route Handlers and Server Actions only. */
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
