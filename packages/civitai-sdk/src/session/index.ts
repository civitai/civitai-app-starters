/** Every scope an app can hold, as the site names them. */
export const SCOPES = [
  'ai:write:budgeted',
  'apps:storage',
  'apps:storage:import',
  'apps:storage:publish',
  'apps:storage:read',
  'apps:storage:shared:read',
  'apps:storage:shared:write',
  'apps:storage:write',
  'apps:store:items:write',
  'buzz:read:self',
  'collections:read:private',
  'collections:read:self',
  'collections:write:self',
  'goods:purchase:self',
  'goods:read:self',
  'models:read:self',
  'posts:write:self',
  'social:react:self',
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
  /**
   * Ask for the viewer's grant IN ANOTHER APP: `apps:storage:publish` in the source of
   * one of this app's `storage.imports` (its blockId), which a write through the import
   * into one of the source's shared collections needs. Pass exactly
   * `['apps:storage:publish']` with it; anything else resolves `false` without asking.
   * The grant is the source's, so this app's token scopes do not change, and only the app
   * page (`/apps/run/<slug>`) prompts for it. `app.storage.collection(name, { from })`
   * asks for it by itself, so an app rarely needs to.
   *
   * 🔴 On a host page `true` means "the host PUSHED a token refresh after the prompt" —
   * which follows an Allow, but can also be the host's routine re-mint, since "Not now"
   * sends nothing. It is not proof of the grant: treat the result of the write you retry
   * as authoritative (a refusal there means no grant). A `TOKEN_REFRESH_RESPONSE` to a
   * `getToken({ fresh: true })` never counts. `false`: the host cannot prompt
   * (`CONSENT_UNAVAILABLE`), or no answer within 60 s; `signal` can end the wait sooner.
   */
  from?: string;
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
