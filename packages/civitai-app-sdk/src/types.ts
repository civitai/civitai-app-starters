export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope: number;
  token_type?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string | number;
  token_type?: string;
}

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  baseUrl?: string;
}
