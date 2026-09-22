import { CivitaiError } from '../core/errors.js';
import type { GrantOptions, Scope, TokenSessionOptions } from '../session/index.js';

export const DEFAULT_AUTH_URL = 'https://auth.civitai.com';

// The site's own table (BLOCK_SCOPE_TO_OAUTH_BIT). Storage and collection scopes have no OAuth bit.
const OAUTH_BITS: Partial<Record<Scope, number>> = {
  'user:read:self': 1 << 0,
  'posts:write:self': 1 << 6,
  'ai:write:budgeted': 1 << 15,
  'buzz:read:self': 1 << 16,
  'social:tip:self': 1 << 20,
  'models:read:self': 1 << 2,
};

/** Refreshed this long before it expires, so a request never carries a token that dies in flight. */
const EXPIRY_MARGIN_MS = 60_000;

export class SignInError extends CivitaiError {
  readonly status?: number;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SignInError';
    this.status = status;
  }
}

type SignInStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SignInOptions {
  /** The OAuth client registered on Civitai as a public (browser) client. */
  clientId: string;
  scopes: readonly Scope[];
  /** Must be registered on the client. Defaults to the current page without its query. */
  redirectUri?: string;
  /** Defaults to `https://auth.civitai.com`. */
  authUrl?: string;
  /** Holds the sign-in in flight and whether the viewer signed in before; never a token. Defaults to `localStorage`. */
  storage?: SignInStorage;
  fetch?: typeof fetch;
  window?: Window;
}

/** Pass it to `initialize()` as it is: it is the token, its refresh and the way to ask for grants. */
export interface SignIn extends TokenSessionOptions {
  token(): Promise<string>;
  refresh(): Promise<string>;
  requestGrants(scopes: readonly Scope[], opts?: GrantOptions): Promise<boolean>;
  readonly signedIn: boolean;
  /** Signed in on an earlier visit. Tokens live only in memory, so `signIn()` again; Civitai remembers the consent. */
  readonly returning: boolean;
  readonly grantedScopes: readonly Scope[];
  /** Why the last return from Civitai did not sign in, e.g. the viewer declined. */
  readonly error: SignInError | null;
  /** Leaves the page for Civitai's sign-in and consent; it comes back to `redirectUri`. */
  signIn(opts?: { scopes?: readonly Scope[] }): Promise<never>;
  signOut(): Promise<void>;
}

interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: number;
}

interface Pending {
  state: string;
  verifier: string;
  redirectUri: string;
  scope: number;
}

export function scopeBitmask(scopes: readonly Scope[]): number {
  let mask = 0;
  for (const scope of scopes) {
    const bit = OAUTH_BITS[scope];
    if (bit === undefined) throw new SignInError(`${scope} is only granted to apps running inside civitai.com`);
    mask |= bit;
  }
  return mask;
}

function scopesIn(mask: number): Scope[] {
  return (Object.keys(OAUTH_BITS) as Scope[]).filter((scope) => (mask & OAUTH_BITS[scope]!) !== 0);
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const randomString = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

async function challengeFor(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

function readJson<T>(storage: SignInStorage, key: string): T | null {
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: SignInStorage, key: string, value: unknown): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the viewer then signs in again next visit.
  }
}

/**
 * Sign-in with Civitai for an app outside civitai.com. Completes the return
 * from Civitai when the page has just come back from it.
 */
export async function createSignIn(options: SignInOptions): Promise<SignIn> {
  const win = options.window ?? window;
  const storage = options.storage ?? win.localStorage;
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const authUrl = options.authUrl ?? DEFAULT_AUTH_URL;
  const key = `civitai.sign-in.${options.clientId}`;
  const pendingKey = `${key}.pending`;
  const returningKey = `${key}.returning`;
  const requested = scopeBitmask(options.scopes);

  let tokens: Tokens | null = null;
  let error: SignInError | null = null;
  let refreshing: Promise<string> | null = null;

  const save = (next: Tokens | null) => {
    tokens = next;
    writeJson(storage, returningKey, next ? true : null);
  };

  const tokenRequest = async (body: Record<string, string>, fallbackScope: number): Promise<Tokens> => {
    const res = await doFetch(`${authUrl}/api/auth/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, client_id: options.clientId }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string | number;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new SignInError(json.error_description ?? json.error ?? `token request failed: ${res.status}`, res.status);
    }
    const scope = Number(json.scope);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? body.refresh_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      // The hub may omit scope when it granted exactly what was asked (RFC 6749 §5.1).
      scope: Number.isSafeInteger(scope) && scope >= 0 ? scope : fallbackScope,
    };
  };

  const refresh = (): Promise<string> => {
    refreshing ??= (async () => {
      const held = tokens;
      if (!held?.refreshToken) {
        save(null);
        throw new SignInError('not signed in', 401);
      }
      try {
        const next = await tokenRequest(
          { grant_type: 'refresh_token', refresh_token: held.refreshToken },
          held.scope,
        );
        save(next);
        return next.accessToken;
      } catch (err) {
        if (err instanceof SignInError && err.status !== undefined && err.status < 500) save(null);
        throw err;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const signIn = async ({ scopes }: { scopes?: readonly Scope[] } = {}): Promise<never> => {
    const verifier = randomString();
    const pending: Pending = {
      state: randomString(),
      verifier,
      redirectUri: options.redirectUri ?? `${win.location.origin}${win.location.pathname}`,
      scope: requested | (scopes ? scopeBitmask(scopes) : 0) | (tokens?.scope ?? 0),
    };
    writeJson(storage, pendingKey, pending);
    const url = new URL('/api/auth/oauth/authorize', authUrl);
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: pending.redirectUri,
      response_type: 'code',
      state: pending.state,
      scope: String(pending.scope),
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
    }).toString();
    win.location.assign(url.toString());
    return new Promise<never>(() => {});
  };

  const params = new URLSearchParams(win.location.search);
  const pending = readJson<Pending>(storage, pendingKey);
  if (pending && params.get('state') === pending.state) {
    writeJson(storage, pendingKey, null);
    const code = params.get('code');
    const clean = new URL(win.location.href);
    for (const key of ['code', 'state', 'error', 'error_description']) clean.searchParams.delete(key);
    win.history.replaceState(win.history.state, '', clean.toString());
    try {
      if (!code) throw new SignInError(params.get('error_description') ?? params.get('error') ?? 'sign-in was declined');
      save(
        await tokenRequest(
          {
            grant_type: 'authorization_code',
            code,
            redirect_uri: pending.redirectUri,
            code_verifier: pending.verifier,
          },
          pending.scope,
        ),
      );
    } catch (err) {
      error = err instanceof SignInError ? err : new SignInError('sign-in failed', undefined, { cause: err });
    }
  }

  return {
    get signedIn() {
      return tokens !== null;
    },
    get returning() {
      return tokens === null && readJson<boolean>(storage, returningKey) === true;
    },
    get grantedScopes() {
      return tokens ? scopesIn(tokens.scope) : [];
    },
    get error() {
      return error;
    },
    token: async () => {
      if (!tokens) throw new SignInError('not signed in', 401);
      return tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now() ? tokens.accessToken : refresh();
    },
    refresh,
    requestGrants: async (scopes: readonly Scope[]) => {
      const wanted = scopeBitmask(scopes);
      if (tokens && (tokens.scope & wanted) === wanted) return true;
      return signIn({ scopes });
    },
    signIn,
    signOut: async () => {
      const held = tokens;
      save(null);
      if (!held) return;
      await doFetch(`${authUrl}/api/auth/oauth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: held.refreshToken ?? held.accessToken, client_id: options.clientId }),
      }).catch(() => undefined);
    },
  };
}
