import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/index.js';
import { EMPTY_SNAPSHOT } from '../../src/core/transport.js';
import { createFakeTransport } from '../../src/testing.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const token = (raw: string, scopes: string[] = []) => ({ raw, scopes, expiresAt: new Date(0) });

describe('initialize() in a block', () => {
  it('resolves once the host has initialised, with what it sent', async () => {
    const transport = createFakeTransport({ ...EMPTY_SNAPSHOT });

    const pending = initialize({ transport });
    transport.setSnapshot({
      ready: true,
      token: token('minted'),
      viewer: { id: 7, username: 'koen' },
      context: { slotId: 'app.page' },
      theme: 'dark',
    });
    const app = await pending;

    expect(app.viewer).toEqual({ id: 7, username: 'koen' });
    expect(app.context).toEqual({ slotId: 'app.page' });
    expect(app.theme).toBe('dark');
    await expect(app.getToken()).resolves.toBe('minted');
  });

  it('says so when no host answers', async () => {
    const transport = createFakeTransport({ ...EMPTY_SNAPSHOT });

    await expect(initialize({ transport, timeoutMs: 10 })).rejects.toMatchObject({
      name: 'BridgeError',
      code: 'unavailable',
      operation: 'BLOCK_INIT',
    });
  });

  it('keeps what it exposes current as the host pushes changes', async () => {
    const transport = createFakeTransport({ theme: 'light' });
    const app = await initialize({ transport });
    let changes = 0;
    app.onChange(() => changes++);

    transport.setSnapshot({ theme: 'dark' });

    expect(app.theme).toBe('dark');
    expect(changes).toBe(1);
  });

  it('calls the API with the token the host minted, and asks the host for UI', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { id: 7 })]);
    const transport = createFakeTransport({ token: token('minted') });
    const app = await initialize({ transport, fetch });

    await expect(app.site.get('me')).resolves.toEqual({ id: 7 });
    expect(calls[0]).toMatchObject({
      url: 'https://civitai.com/api/v1/me',
      headers: { Authorization: 'Bearer minted' },
    });

    app.host.requestSignIn();
    expect(transport.sent.at(-1)).toEqual({ type: 'REQUEST_SIGN_IN', payload: {} });
  });

  it('routes grants through the host', async () => {
    const transport = createFakeTransport({ token: token('minted') });
    const app = await initialize({ transport });

    const pending = app.requestGrants(['ai:write:budgeted']);
    transport.setSnapshot({ token: token('wider', ['ai:write:budgeted']) });

    await expect(pending).resolves.toBe(true);

    // @ts-expect-error a scope the site does not grant is a typo, not a request
    void app.requestGrants(['ai:write:unbudgeted']);
  });
});

describe('initialize({ token })', () => {
  it('is ready at once and talks to both APIs with the token', async () => {
    const { fetch, calls } = fakeFetch([
      () => json(200, { items: [] }),
      () => json(200, { id: 'wf_1', status: 'unassigned', steps: [] }),
    ]);
    const app = await initialize({ token: 'civitai_abc', fetch });

    await app.site.get('images', { query: { limit: 1 } });
    await app.orchestration.submitWorkflow({ currencies: [], steps: [] });

    expect(calls.map((c) => [c.url, c.headers.Authorization])).toEqual([
      ['https://civitai.com/api/v1/images?limit=1', 'Bearer civitai_abc'],
      ['https://orchestration.civitai.com/v2/consumer/workflows', 'Bearer civitai_abc'],
    ]);
    expect('host' in app).toBe(false);
    // @ts-expect-error an app outside a block has no host to ask
    void app.host;
  });
});
