import { NextResponse, type NextRequest } from 'next/server';
import { refreshToken as oauthRefresh, sealCookie } from '@civitai/app-sdk';
import { env } from '@/lib/env';
import {
  needsRefresh,
  parseSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/session-cookie';

/**
 * 🔴 THE ONLY PLACE THE SESSION IS REFRESHED.
 *
 * Next.js permits cookie writes in Route Handlers, Server Actions and this
 * file — and nowhere else. `getSession()` used to refresh in place, but its
 * primary caller is a Server Component, so both of its write arms
 * (`setSession` on success, `clearSession` on failure) threw
 * `Cookies can only be modified in a Server Action or Route Handler` and took
 * the whole render down with them. Moving refresh here fixes both arms at once
 * and leaves `getSession()` a pure read.
 *
 * FILE NAME: `proxy.ts`, not `middleware.ts`. Next.js 16 renamed the
 * convention; `middleware.ts` still runs but logs a deprecation warning on
 * every build, which is the wrong thing for a template to teach. `proxy` is
 * ALWAYS the Node.js runtime — which is what `sealCookie`/`unsealCookie` need,
 * since `node:crypto` is unavailable on edge — and it is not configurable:
 * exporting `runtime` from this file THROWS. That is why there is no
 * `export const runtime` here.
 *
 * It runs BEFORE the render, so it can do the one thing a render cannot:
 * rewrite the request the render is about to see. Each branch therefore makes
 * TWO edits that must agree —
 *
 *   - `request.cookies` — what THIS render/handler reads, and
 *   - `response.cookies` — what the BROWSER keeps for the next request.
 *
 * Changing only the response would leave this render still holding the dead
 * cookie; changing only the request would make the browser re-send it forever.
 */

export const config = {
  matcher: [
    /**
     * Everything except Next's own static output and obvious asset requests.
     * Those never carry a session decision and would only add scrypt work.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif|woff|woff2|ttf|otf|css|js|map)$).*)',
  ],
};

/** Cookie attributes — must match `session.ts`'s `writeCookie`. */
function sessionCookieOptions(maxAge: number) {
  return {
    maxAge,
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
}

export async function proxy(request: NextRequest) {
  const sealed = request.cookies.get(SESSION_COOKIE)?.value;
  const session = parseSession(sealed, env.SESSION_SECRET);

  // No cookie, or one we cannot read at all. Nothing to refresh; leave a
  // garbage cookie alone so a secret rotation does not log everyone out via a
  // surprise Set-Cookie on every asset request.
  if (!session) return NextResponse.next();

  // Token still good — the overwhelmingly common case. No crypto, no network.
  if (!needsRefresh(session)) return NextResponse.next();

  if (session.tokens.refresh_token) {
    try {
      const tokens = await oauthRefresh({
        baseUrl: env.CIVITAI_AUTH_URL,
        clientId: env.CIVITAI_CLIENT_ID,
        clientSecret: env.CIVITAI_CLIENT_SECRET,
        refreshToken: session.tokens.refresh_token,
        // The refreshed blob REPLACES the stored one below, so a `scope` the
        // server omits (RFC 6749 §6 permits it) would be persisted as 0 and
        // lock the user out of features their token still grants.
        fallbackScope: session.tokens.scope,
      });
      const refreshed = sealCookie(
        JSON.stringify({ ...session, tokens }),
        env.SESSION_SECRET,
      );
      // Both edits, in the order described above.
      request.cookies.set(SESSION_COOKIE, refreshed);
      const response = NextResponse.next({ request });
      response.cookies.set(
        SESSION_COOKIE,
        refreshed,
        sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
      );
      return response;
    } catch {
      // Refresh token revoked or itself expired — fall through and clear.
    }
  }

  // Expired with no usable refresh: strip it from the request so the render
  // sees a logged-out viewer, and clear it on the response so the browser stops
  // re-sending a cookie that can never work again.
  request.cookies.delete(SESSION_COOKIE);
  const response = NextResponse.next({ request });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}
