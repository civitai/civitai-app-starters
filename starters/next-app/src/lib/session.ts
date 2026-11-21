import { cookies } from 'next/headers';
import { buildSetCookieHeader, sealCookie, unsealCookie } from '@civitai/app-sdk';
import 'server-only';
import { env } from './env';
import { forgetRefreshesFor } from './refresh-tokens';
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
 * Refresh now happens in `src/proxy.ts` (Next 16's rename of `middleware.ts`),
 * which runs before the render and
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

/**
 * The session cookie AS STORED: no expiry check, and (on the sign-out routes,
 * which `src/proxy.ts` skips) no refresh. For sign-out only.
 *
 * The revoke route reads the tokens it sends upstream from here, not from
 * `getSession()`, which answers `null` for a token that needs a refresh. When
 * that refresh failed without `invalid_grant` (a 503, a timeout), revoke
 * skipped the upstream revoke and still cleared the cookie, leaving a live
 * refresh token at Civitai.
 */
export async function getStoredSession(): Promise<Session | null> {
  const jar = await cookies();
  return parseSession(jar.get(SESSION_COOKIE)?.value, env.SESSION_SECRET);
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

/**
 * Sign out: forget this session's remembered refreshes, then clear the cookie.
 * Route Handlers and Server Actions only.
 *
 * The first half matters because `src/proxy.ts` keeps a successful refresh
 * for 60 s, keyed by the PREVIOUS refresh token, so a straggler with the old
 * cookie gets the rotation. Without forgetting it, a request carrying the
 * pre-rotation cookie inside that window was handed this session's tokens
 * again after sign-out. Read from the raw cookie, not `getSession()`, which
 * returns `null` for a token that needs a refresh.
 *
 * Pass `{ revokeOrphans: true }` from the revoke route only: a refresh of this
 * session that is still in flight and then succeeds has its new refresh token
 * revoked upstream too (see `forgetRefreshesFor`). A plain sign-out leaves the
 * upstream tokens alone.
 */
export async function clearSession({
  revokeOrphans = false,
}: { revokeOrphans?: boolean } = {}): Promise<void> {
  forgetRefreshesFor((await getStoredSession())?.tokens, { revokeOrphans });
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
