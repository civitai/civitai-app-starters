import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { buildAuthorizeUrl, generatePkce, generateState } from '@civitai/app-sdk';
import { config, REDIRECT_URI } from '$lib/env';
import { REQUESTED_SCOPES } from '$lib/scopes';
import { writeOAuthState } from '$lib/session';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  const pkce = generatePkce();
  const state = generateState();

  writeOAuthState(cookies, { state, verifier: pkce.verifier, scope: REQUESTED_SCOPES }, !dev);

  const authorizeUrl = buildAuthorizeUrl({
    baseUrl: config.CIVITAI_BASE_URL,
    clientId: config.CIVITAI_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: REQUESTED_SCOPES,
    state,
    codeChallenge: pkce.challenge,
  });

  throw redirect(303, authorizeUrl);
};
