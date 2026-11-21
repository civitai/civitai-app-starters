import { NextResponse } from 'next/server';
import { revokeToken } from '@civitai/app-sdk';
import { env } from '@/lib/env';
import { clearSession, getStoredSession } from '@/lib/session';

export async function POST() {
  // The stored cookie, not `getSession()`, which is null for a token that
  // needs a refresh: the proxy does not refresh sign-out routes, and the
  // stored refresh token is the one Civitai still honours.
  const session = await getStoredSession();
  // End the session BEFORE the upstream round trips: clearSession() forgets
  // its remembered refreshes, so a request another tab has waiting on one is
  // signed out instead of being handed the tokens while revoke is waiting.
  // `revokeOrphans`: if such a refresh still succeeds, its new refresh token
  // is revoked too, since the cookie's one, revoked below, is the one it spent.
  await clearSession({ revokeOrphans: true });
  // Best-effort revoke at Civitai — either token may already be invalid,
  // and we still want to clear our own cookie either way.
  const tryRevoke = async (token: string) => {
    try {
      await revokeToken({
        baseUrl: env.CIVITAI_AUTH_URL,
        clientId: env.CIVITAI_CLIENT_ID,
        clientSecret: env.CIVITAI_CLIENT_SECRET,
        token,
      });
    } catch {
      // Ignored — see comment above.
    }
  };
  if (session?.tokens.access_token) await tryRevoke(session.tokens.access_token);
  if (session?.tokens.refresh_token) await tryRevoke(session.tokens.refresh_token);
  return NextResponse.json({ ok: true });
}
