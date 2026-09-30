/** Every scope an app can hold, as the site names them. */
export const SCOPES = [
  'ai:write:budgeted',
  'apps:storage:read',
  'apps:storage:shared:read',
  'apps:storage:shared:write',
  'apps:storage:write',
  'buzz:read:self',
  'collections:read:private',
  'collections:read:self',
  'collections:write:self',
  'models:read:self',
  'posts:write:self',
  'social:tip:self',
  'user:read:self',
] as const;

export type Scope = (typeof SCOPES)[number];

export interface TokenOptions {
  /** Skip the held token and get a new one, e.g. after the API refused it. */
  fresh?: boolean;
  signal?: AbortSignal;
}

export interface GrantOptions {
  signal?: AbortSignal;
}

/** Where the app's token comes from. Everything that calls an API reads it here. */
export interface Session {
  getToken(opts?: TokenOptions): Promise<string>;
  requestGrants(scopes: readonly Scope[], opts?: GrantOptions): Promise<boolean>;
}

export type TokenSource = string | ((opts: { signal?: AbortSignal }) => string | Promise<string>);

export interface TokenSessionOptions {
  token: TokenSource;
  /** How to get a new token when the API refuses one. Defaults to reading `token` again. */
  refresh?: (opts: { signal?: AbortSignal }) => string | Promise<string>;
  /** How to ask the viewer for more scopes. Defaults to refusing, since there is no one to ask. */
  requestGrants?: (scopes: readonly Scope[], opts: GrantOptions) => boolean | Promise<boolean>;
}

export function createTokenSession(options: TokenSessionOptions): Session {
  const read = (signal?: AbortSignal) =>
    Promise.resolve(typeof options.token === 'string' ? options.token : options.token({ signal }));

  return {
    getToken: ({ fresh, signal } = {}) =>
      fresh && options.refresh ? Promise.resolve(options.refresh({ signal })) : read(signal),
    requestGrants: (scopes, opts = {}) =>
      Promise.resolve(options.requestGrants ? options.requestGrants(scopes, opts) : false),
  };
}
