import { dev } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { exchangeCode, OAuthError } from '@civitai/app-sdk';
import { config, REDIRECT_URI } from '$lib/env';
import { consumeOAuthState, writeSession } from '$lib/session';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const expected = consumeOAuthState(cookies, !dev);

  if (error) throw redirect(303, `/?error=${encodeURIComponent('oauth_error:' + error)}`);
  if (!code || !state) throw redirect(303, '/?error=missing_code_or_state');
  if (!expected || expected.state !== state) throw redirect(303, '/?error=state_mismatch');

  try {
    const tokens = await exchangeCode({
      baseUrl: config.CIVITAI_BASE_URL,
      clientId: config.CIVITAI_CLIENT_ID,
      clientSecret: config.CIVITAI_CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      code,
      codeVerifier: expected.verifier,
    });
    writeSession(cookies, { tokens }, !dev);
  } catch (err) {
    const msg =
      err instanceof OAuthError ? `token_exchange:${err.status}` : 'token_exchange_failed';
    throw redirect(303, `/?error=${encodeURIComponent(msg)}`);
  }

  throw redirect(303, '/?notice=connected');
};
