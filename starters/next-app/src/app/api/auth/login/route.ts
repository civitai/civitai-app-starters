import { NextResponse } from 'next/server';
import { buildAuthorizeUrl, generatePkce, generateState } from '@civitai/app-sdk';
import { env, REDIRECT_URI } from '@/lib/env';
import { REQUESTED_SCOPES } from '@/lib/scopes';
import { setOAuthState } from '@/lib/session';

export async function POST() {
  const pkce = generatePkce();
  const state = generateState();

  await setOAuthState({
    state,
    verifier: pkce.verifier,
    scope: REQUESTED_SCOPES,
  });

  const authorizeUrl = buildAuthorizeUrl({
    baseUrl: env.CIVITAI_BASE_URL,
    clientId: env.CIVITAI_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: REQUESTED_SCOPES,
    state,
    codeChallenge: pkce.challenge,
  });

  return NextResponse.redirect(authorizeUrl, { status: 303 });
}
