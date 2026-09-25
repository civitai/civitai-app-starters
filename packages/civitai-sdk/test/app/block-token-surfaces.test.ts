import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { ApiError } from '../../src/http/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { createFakeAppStorage } from '../support/fake-app-storage.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

/**
 * 🔴 WHAT THE TOKEN KIND ACTUALLY DECIDES.
 *
 * `initialize()` used to reject outright whenever a signed-in viewer's token was
 * the block JWT. That is the DEFAULT configuration on the host — the OAuth mint
 * is behind `APP_BLOCK_OAUTH_TOKENS_ENABLED`, which defaults false — so a block
 * that had opted in correctly still got the block token and could not start at
 * all, including on the `blocks/*` routes that token is minted for, and
 * including the `consent_required` fallback whose whole purpose is to let the
 * block ask for consent.
 *
 * These pin the narrowed contract: the token kind is a fact about which
 * SURFACES are reachable, not about whether the app may run.
 */

const token = (raw: string, kind?: 'block' | 'oauth', scopes: string[] = []) => ({
  raw,
  scopes,
  expiresAt: new Date(0),
  ...(kind ? { kind } : {}),
});

const VIEWER = { id: 7, username: 'koen' };

/**
 * A transport that also answers `REQUEST_TOKEN`, because `createHttp` retries a
 * 401 once with a fresh token: without an answer the refresh never settles and
 * the assertion becomes a timeout instead of a verdict.
 */
function transportFor(snapshot: Parameters<typeof createFakeTransport>[0]) {
  const transport = createFakeTransport(snapshot);
  transport.handle('REQUEST_TOKEN', () => ({
    token: { ...transport.snapshot.get().token, expiresAt: new Date(0).toISOString() },
  }));
  return transport;
}

/** A signed-in viewer holding the block JWT: the default host configuration. */
const blockTokenTransport = () => transportFor({ token: token('jwt', 'block'), viewer: VIEWER });

describe('(a) a block token for a signed-in viewer is not in itself an error', () => {
  it('initialize() resolves, and hands over the viewer, the slot and the token', async () => {
    const app = await initialize({ transport: blockTokenTransport() });

    expect(app.viewer).toEqual(VIEWER);
    await expect(app.getToken()).resolves.toBe('jwt');
  });

  it('reaches app.storage, which REQUIRES the block token', async () => {
    const fake = createFakeAppStorage({ seed: [{ key: 'k', value: { n: 1 } }] });
    const app = await initialize({ transport: blockTokenTransport(), fetch: fake.fetch });

    await expect(app.storage.get('k')).resolves.toEqual({ n: 1 });
  });

  it('reaches a blocks/* route through app.site — the token was minted for it', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { id: 7 })]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    await expect(app.site.get('blocks/me')).resolves.toEqual({ id: 7 });
    expect(calls[0]).toMatchObject({
      url: 'https://civitai.com/api/v1/blocks/me',
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('can still ask the host for consent — the consent_required fallback is reachable', async () => {
    const transport = blockTokenTransport();
    const app = await initialize({ transport });

    const pending = app.requestGrants(['apps:storage:write']);

    // The block got far enough to ASK. That is the whole point of the fallback:
    // the host re-mints once the viewer consents.
    expect(transport.sent.at(-1)).toEqual({
      type: 'REQUEST_CONSENT',
      payload: { scopes: ['apps:storage:write'] },
    });
    transport.setSnapshot({ token: token('wider', 'block', ['apps:storage:write']) });
    await expect(pending).resolves.toBe(true);
  });
});

describe('(b) a surface the block token cannot serve still names the manifest opt-in', () => {
  it('refuses an orchestrator call up front, without spending a request', async () => {
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    await expect(app.orchestration.submitWorkflow({ steps: [] })).rejects.toMatchObject({
      name: 'CivitaiError',
      message: expect.stringContaining('auth: "oauth"'),
    });
    // Eager, because the destination is statically known: no round trip at all.
    expect(calls).toEqual([]);
  });

  it('explains an /api/v1 refusal, keeping the status and body a caller branches on', async () => {
    const { fetch } = fakeFetch([
      () => json(401, { error: 'Unauthorized' }),
      () => json(401, { error: 'Unauthorized' }),
    ]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    const error = await app.site.get('me').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).body).toEqual({ error: 'Unauthorized' });
    // The server's own sentence is kept; the diagnosis is added to it.
    expect((error as ApiError).message).toContain('Unauthorized');
    expect((error as ApiError).message).toContain('auth: "oauth"');
  });

  it('explains a 403 too — a scope refusal is the other shape this takes', async () => {
    const { fetch } = fakeFetch([() => json(403, { error: 'Forbidden' })]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    const error = await app.site.get('me').catch((e: unknown) => e);

    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toContain('auth: "oauth"');
  });

  it('says nothing on a failure the token kind cannot explain', async () => {
    const { fetch } = fakeFetch([() => json(404, { error: 'Not found' })]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    const error = await app.site.get('me').catch((e: unknown) => e);

    // A 404 is a route that does not exist. Advising the manifest here would be
    // a guess dressed as a diagnosis.
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).message).toBe('Not found');
  });

  it('still refuses at initialize() when the block declares it needs OAuth', async () => {
    await expect(
      initialize({ transport: blockTokenTransport(), requireOAuthToken: true }),
    ).rejects.toMatchObject({
      name: 'CivitaiError',
      message: expect.stringContaining('auth: "oauth"'),
    });
  });
});

describe('(b2) the diagnosis is never added where the block token is the RIGHT token', () => {
  it('leaves a blocks/* refusal alone — a 401 there is not about the token kind', async () => {
    const { fetch } = fakeFetch([
      () => json(401, { error: 'Unauthorized' }),
      () => json(401, { error: 'Unauthorized' }),
    ]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    const error = await app.site.get('blocks/shared-storage/get').catch((e: unknown) => e);

    expect((error as ApiError).message).toBe('Unauthorized');
    expect((error as ApiError).message).not.toContain('oauth');
  });

  it('leaves an app-storage refusal alone — app storage has no OAuth equivalent', async () => {
    const { fetch } = fakeFetch([
      () => json(401, { error: 'Unauthorized' }),
      () => json(401, { error: 'Unauthorized' }),
    ]);
    const app = await initialize({ transport: blockTokenTransport(), fetch });

    const error = await app.storage.get('k').catch((e: unknown) => e);

    expect((error as ApiError).message).toBe('Unauthorized');
    expect((error as ApiError).message).not.toContain('oauth');
  });
});

/**
 * INVARIANT GUARDS, not regression coverage: these passed before the narrowing
 * too, and they are here to pin that it did not reach them. `viewer === null`
 * and an absent `kind` are the two wire facts the old guard already let through,
 * and both must keep behaving exactly as they did.
 */
describe('(c) anonymous viewers and hosts that send no kind are untouched', () => {
  it('an anonymous viewer holding a block token calls the orchestrator as before', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { id: 'wf_1', status: 'unassigned', steps: [] })]);
    const app = await initialize({
      transport: transportFor({ token: token('jwt', 'block'), viewer: null }),
      fetch,
    });

    await expect(app.orchestration.submitWorkflow({ steps: [] })).resolves.toMatchObject({
      id: 'wf_1',
    });
    // The request went out. An anonymous viewer gets no OAuth token whatever the
    // manifest says, so the manifest is not their fix and must not be named.
    expect(calls).toHaveLength(1);
  });

  it('an anonymous viewer gets no manifest advice on an /api/v1 refusal', async () => {
    const { fetch } = fakeFetch([
      () => json(401, { error: 'Unauthorized' }),
      () => json(401, { error: 'Unauthorized' }),
    ]);
    const app = await initialize({
      transport: transportFor({ token: token('jwt', 'block'), viewer: null }),
      fetch,
    });

    const error = await app.site.get('me').catch((e: unknown) => e);

    expect((error as ApiError).message).toBe('Unauthorized');
  });

  it('a host that predates `kind` is treated as before, on both surfaces', async () => {
    const { fetch, calls } = fakeFetch([
      () => json(200, { id: 7 }),
      () => json(200, { id: 'wf_1', status: 'unassigned', steps: [] }),
    ]);
    const app = await initialize({
      transport: transportFor({ token: token('unkinded'), viewer: VIEWER }),
      fetch,
    });

    await expect(app.site.get('me')).resolves.toEqual({ id: 7 });
    await expect(app.orchestration.submitWorkflow({ steps: [] })).resolves.toMatchObject({
      id: 'wf_1',
    });
    expect(calls).toHaveLength(2);
  });

  it('an OAuth token reaches both surfaces, and `requireOAuthToken` is satisfied by it', async () => {
    const { fetch } = fakeFetch([() => json(200, { id: 7 })]);
    const app = await initialize({
      transport: transportFor({ token: token('oauth-at', 'oauth'), viewer: VIEWER }),
      fetch,
      requireOAuthToken: true,
    });

    await expect(app.site.get('me')).resolves.toEqual({ id: 7 });
  });
});

describe('(d) initialize({ token }) knows no kind, so nothing here applies to it', () => {
  it('calls the orchestrator with the token it was given', async () => {
    const { fetch, calls } = fakeFetch([
      () => json(200, { id: 'wf_1', status: 'unassigned', steps: [] }),
    ]);
    const app = await initialize({ token: 'civitai_abc', fetch });

    await app.orchestration.submitWorkflow({ steps: [] });

    expect(calls[0]!.headers.Authorization).toBe('Bearer civitai_abc');
  });
});
