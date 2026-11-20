export interface BuildAuthorizeUrlOptions {
  baseUrl?: string;
  clientId: string;
  redirectUri: string;
  scope: number;
  state: string;
  codeChallenge: string;
  codeChallengeMethod?: 'S256';
}

// The OAuth authorize endpoint lives on the standalone auth hub.
const DEFAULT_AUTH_BASE_URL = 'https://auth.civitai.com';

/**
 * Build the Civitai OAuth authorize URL. The returned URL is what you redirect
 * the browser to. Token exchange happens on the redirect_uri callback.
 *
 * `scope` is a bitmask — compose it from named flags with
 * {@link bitmaskFromScopes} rather than hard-coding a number.
 *
 * @example
 * const { challenge } = generatePkce();
 * const url = buildAuthorizeUrl({
 *   clientId: process.env.CIVITAI_CLIENT_ID!,
 *   redirectUri: 'https://your-app.com/api/auth/callback/civitai',
 *   scope: bitmaskFromScopes(['AIServicesWrite', 'BuzzRead', 'UserRead']),
 *   state: generateState(),
 *   codeChallenge: challenge,
 * });
 */
export function buildAuthorizeUrl(opts: BuildAuthorizeUrlOptions): string {
  const base = opts.baseUrl ?? DEFAULT_AUTH_BASE_URL;
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
