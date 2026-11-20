import { dev } from '$app/environment';
import { json } from '@sveltejs/kit';
import { revokeToken } from '@civitai/app-sdk';
import { config } from '$lib/env';
import { clearSession } from '$lib/session';
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

export const POST: RequestHandler = async ({ cookies, locals }) => {
  const tokens = locals.session?.tokens;
  await tryRevoke(tokens?.access_token);
  await tryRevoke(tokens?.refresh_token);
  clearSession(cookies, !dev);
  return json({ ok: true });
};
