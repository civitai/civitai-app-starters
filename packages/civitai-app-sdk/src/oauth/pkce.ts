import { createHash, randomBytes } from 'node:crypto';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Pkce {
  verifier: string;
  challenge: string;
  method: 'S256';
}

/** Generate a PKCE code verifier and S256 challenge. */
export function generatePkce(): Pkce {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

/** Generate a random URL-safe state value for OAuth state-parameter use. */
export function generateState(byteLength = 16): string {
  return base64UrlEncode(randomBytes(byteLength));
}
