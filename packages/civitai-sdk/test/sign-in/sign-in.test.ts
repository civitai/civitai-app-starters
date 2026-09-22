import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { createSignIn, scopeBitmask, SignInError, type SignInOptions } from '../../src/sign-in/index.js';

const AI_AND_USER = (1 << 0) | (1 << 15);

function page(url = 'https://brawl.example/play') {
  const store = new Map<string, string>();
  const location = new URL(url);
  const visited: string[] = [];
  const win = {
    get location() {
      return {
        origin: location.origin,
        pathname: location.pathname,
        search: location.search,
        href: location.href,
        assign: (to: string) => visited.push(to),
      };
    },
    history: {
      state: null,
      replaceState: (_s: unknown, _t: string, to: string) => {
        location.href = to;
      },
    },
  } as unknown as Window;
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const returnTo = (query: string) => {
    location.search = query;
  };
  const nextVisit = async () => {
    const seen = visited.length;
    while (visited.length === seen) await new Promise((r) => setTimeout(r, 1));
    return new URL(visited.at(-1)!);
  };
  return { win, storage, store, visited, location, returnTo, nextVisit };
}

type Call = { url: string; body: URLSearchParams; auth?: string };

function server(respond: (call: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      body: new URLSearchParams(init?.body instanceof URLSearchParams ? init.body : undefined),
      auth: new Headers(init?.headers).get('authorization') ?? undefined,
    };
    calls.push(call);
    const { status = 200, json } = respond(call);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const issued = (access: string, extra: Record<string, unknown> = {}) => ({
  json: { access_token: access, refresh_token: `r-${access}`, expires_in: 3600, scope: String(AI_AND_USER), ...extra },
});

async function signedInVia(p: ReturnType<typeof page>, respond: Parameters<typeof server>[0]) {
  const hub = server(respond);
  const options: SignInOptions = {
    clientId: 'brawl',
    scopes: ['user:read:self', 'ai:write:budgeted'],
    window: p.win,
    storage: p.storage,
    fetch: hub.fetch,
  };
  const first = await createSignIn(options);
  const visit = p.nextVisit();
  void first.signIn();
  const authorize = await visit;
  p.returnTo(`?code=abc&state=${authorize.searchParams.get('state')}`);
  return { auth: await createSignIn(options), hub, authorize, options };
}

describe('scopeBitmask', () => {
  it('maps the site’s scope names onto its OAuth bits', () => {
    expect(scopeBitmask(['user:read:self', 'ai:write:budgeted'])).toBe(AI_AND_USER);
  });

  it('refuses a scope only a block inside civitai.com can hold', () => {
    expect(() => scopeBitmask(['apps:storage:read'])).toThrow(SignInError);
  });
});

describe('createSignIn', () => {
  it('sends the viewer to Civitai with a PKCE challenge, and comes back to the same page', async () => {
    const p = page();
    const { authorize, hub } = await signedInVia(p, () => issued('a1'));

    expect(authorize.origin + authorize.pathname).toBe('https://auth.civitai.com/api/auth/oauth/authorize');
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://brawl.example/play');
    expect(authorize.searchParams.get('scope')).toBe(String(AI_AND_USER));
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');

    const verifier = hub.calls[0]!.body.get('code_verifier')!;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(authorize.searchParams.get('code_challenge')).toBe(challenge);
  });

  it('finishes the return from Civitai: exchanges the code and takes it out of the address bar', async () => {
    const p = page();
    const { auth, hub } = await signedInVia(p, () => issued('a1'));

    expect(hub.calls[0]!.body.get('grant_type')).toBe('authorization_code');
    expect(hub.calls[0]!.body.get('code')).toBe('abc');
    expect(auth.signedIn).toBe(true);
    expect(auth.grantedScopes).toEqual(['user:read:self', 'ai:write:budgeted']);
    expect(p.location.search).toBe('');
    await expect(auth.token()).resolves.toBe('a1');
  });

  it('remembers that the viewer signed in, but never stores a token', async () => {
    const p = page();
    const { options } = await signedInVia(p, () => issued('a1'));

    const later = await createSignIn(options);

    expect(later.signedIn).toBe(false);
    expect(later.returning).toBe(true);
    expect([...p.store.values()].join()).not.toMatch(/a1/);
  });

  it('ignores a code whose state it did not send', async () => {
    const p = page();
    const hub = server(() => issued('never'));
    const options = { clientId: 'brawl', scopes: ['user:read:self'] as const, window: p.win, storage: p.storage, fetch: hub.fetch };
    const visit = p.nextVisit();
    void (await createSignIn(options)).signIn();
    await visit;
    p.returnTo('?code=stolen&state=forged');

    const auth = await createSignIn(options);

    expect(hub.calls).toHaveLength(0);
    expect(auth.signedIn).toBe(false);
  });

  it('reports a declined consent instead of signing in', async () => {
    const p = page();
    const hub = server(() => issued('never'));
    const options = { clientId: 'brawl', scopes: ['user:read:self'] as const, window: p.win, storage: p.storage, fetch: hub.fetch };
    const visit = p.nextVisit();
    void (await createSignIn(options)).signIn();
    const state = (await visit).searchParams.get('state');
    p.returnTo(`?error=access_denied&state=${state}`);

    const auth = await createSignIn(options);

    expect(auth.signedIn).toBe(false);
    expect(auth.error?.message).toBe('access_denied');
    expect(hub.calls).toHaveLength(0);
  });

  it('refreshes a token about to expire, once for every caller waiting on it', async () => {
    const p = page();
    let n = 0;
    const { auth, hub } = await signedInVia(p, (call) =>
      call.body.get('grant_type') === 'refresh_token' ? issued(`a${++n + 1}`) : issued('a1', { expires_in: 30 }),
    );

    const [x, y] = await Promise.all([auth.token(), auth.token()]);

    expect([x, y]).toEqual(['a2', 'a2']);
    expect(hub.calls.filter((c) => c.body.get('grant_type') === 'refresh_token')).toHaveLength(1);
    expect(hub.calls.at(-1)!.body.get('refresh_token')).toBe('r-a1');
  });

  it('signs out when Civitai refuses the refresh token', async () => {
    const p = page();
    const { auth } = await signedInVia(p, (call) =>
      call.body.get('grant_type') === 'refresh_token'
        ? { status: 400, json: { error: 'invalid_grant' } }
        : issued('a1', { expires_in: 30 }),
    );

    await expect(auth.token()).rejects.toThrow('invalid_grant');
    expect(auth.signedIn).toBe(false);
  });

  it('grants what was consented to, and goes back to Civitai for anything more', async () => {
    const p = page();
    const { auth } = await signedInVia(p, () => issued('a1'));

    await expect(auth.requestGrants(['ai:write:budgeted'], {})).resolves.toBe(true);

    const visit = p.nextVisit();
    void auth.requestGrants(['buzz:read:self'], {});
    const again = await visit;
    expect(Number(again.searchParams.get('scope'))).toBe(AI_AND_USER | (1 << 16));
  });

  it('revokes the refresh token on sign-out', async () => {
    const p = page();
    const { auth, hub } = await signedInVia(p, () => issued('a1'));

    await auth.signOut();

    expect(auth.signedIn).toBe(false);
    expect(auth.returning).toBe(false);
    expect(hub.calls.at(-1)!.url).toBe('https://auth.civitai.com/api/auth/oauth/revoke');
    expect(hub.calls.at(-1)!.body.get('token')).toBe('r-a1');
  });

  it('is what initialize() takes, so the orchestrator is called as the signed-in viewer', async () => {
    const p = page();
    const { auth } = await signedInVia(p, () => issued('a1'));
    const api = server(() => ({ json: { id: 'wf', status: 'unassigned', steps: [] } }));

    const app = await initialize({ ...auth, fetch: api.fetch });
    await app.orchestration.getWorkflow('wf');

    expect(api.calls[0]!.auth).toBe('Bearer a1');
  });
});
