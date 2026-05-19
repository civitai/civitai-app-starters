export interface BuildAuthorizeUrlOptions {
  baseUrl?: string;
  clientId: string;
  redirectUri: string;
  scope: number;
  state: string;
  codeChallenge: string;
  codeChallengeMethod?: 'S256';
}

const DEFAULT_CIVITAI_BASE_URL = 'https://civitai.com';

/**
 * Build the Civitai OAuth authorize URL. The returned URL is what you redirect
 * the browser to. Token exchange happens on the redirect_uri callback.
 */
export function buildAuthorizeUrl(opts: BuildAuthorizeUrlOptions): string {
  const base = opts.baseUrl ?? DEFAULT_CIVITAI_BASE_URL;
  const url = new URL('/api/auth/oauth/authorize', base);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', opts.state);
  url.searchParams.set('scope', String(opts.scope));
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', opts.codeChallengeMethod ?? 'S256');
  return url.toString();
}
