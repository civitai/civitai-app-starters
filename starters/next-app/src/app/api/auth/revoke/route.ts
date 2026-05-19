import { NextResponse } from 'next/server';
import { revokeToken } from '@civitai/app-sdk';
import { env } from '@/lib/env';
import { clearSession, getSession } from '@/lib/session';

export async function POST() {
  const session = await getSession();
  // Best-effort revoke at Civitai — either token may already be invalid,
  // and we still want to clear our own cookie either way.
  const tryRevoke = async (token: string) => {
    try {
      await revokeToken({
        baseUrl: env.CIVITAI_BASE_URL,
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
  await clearSession();
  return NextResponse.json({ ok: true });
}
