import { NextResponse, type NextRequest } from 'next/server';
import { exchangeCode, OAuthError } from '@civitai/app-sdk';
import { env, REDIRECT_URI } from '@/lib/env';
import { consumeOAuthState, setSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const expected = await consumeOAuthState();

  if (error) return redirectHome(req, `oauth_error:${error}`);
  if (!code || !state) return redirectHome(req, 'missing_code_or_state');
  if (!expected || expected.state !== state) return redirectHome(req, 'state_mismatch');

  try {
    const tokens = await exchangeCode({
      baseUrl: env.CIVITAI_BASE_URL,
      clientId: env.CIVITAI_CLIENT_ID,
      clientSecret: env.CIVITAI_CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code,
      codeVerifier: expected.verifier,
    });
    await setSession({ tokens });
  } catch (err) {
    const msg =
      err instanceof OAuthError ? `token_exchange:${err.status}` : 'token_exchange_failed';
    return redirectHome(req, msg);
  }

  return redirectHome(req, undefined, 'connected');
}

function redirectHome(req: NextRequest, error?: string, notice?: string): NextResponse {
  const url = new URL('/', req.url);
  if (error) url.searchParams.set('error', error);
  if (notice) url.searchParams.set('notice', notice);
  return NextResponse.redirect(url, { status: 303 });
}
