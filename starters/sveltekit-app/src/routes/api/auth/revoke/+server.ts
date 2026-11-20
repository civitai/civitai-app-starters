import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { revokeToken } from '@civitai/app-sdk';
import { config } from '$lib/env';
import { clearSession, parseSession } from '$lib/session';
import type { RequestHandler } from './$types';

async function tryRevoke(token: string | undefined) {
  if (!token) return;
  try {
    await revokeToken({
      baseUrl: config.CIVITAI_AUTH_URL,
      clientId: config.CIVITAI_CLIENT_ID,
      clientSecret: config.CIVITAI_CLIENT_SECRET,
      token,
    });
  } catch {
    // Best-effort — we still clear the local session below.
  }
}

export const POST: RequestHandler = async ({ cookies }) => {
  // The stored cookie, not `locals.session`: a sign-out does not refresh
  // (`SIGN_OUT_PATHS`), and a refresh that failed without `invalid_grant`
  // leaves `locals.session` null, which skipped the upstream revoke while the
  // cookie was still cleared. The stored refresh token is the one Civitai
  // still honours.
  const tokens = parseSession(cookies)?.tokens;
  // End the session BEFORE the upstream round trips: clearSession() forgets
  // its remembered refreshes, so a request another tab has waiting on one is
  // signed out instead of being handed the tokens while revoke is waiting.
  clearSession(cookies, !dev);
  await tryRevoke(tokens?.access_token);
  await tryRevoke(tokens?.refresh_token);
  return json({ ok: true });
};
