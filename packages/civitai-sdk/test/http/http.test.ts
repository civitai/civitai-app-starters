import { describe, expect, it } from 'vitest';

import { CivitaiError } from '../../src/core/errors.js';
import { ApiError, createHttp } from '../../src/http/index.js';
import { createTokenSession } from '../../src/session/index.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const BASE = 'https://civitai.com/api/v1';

describe('createHttp', () => {
  it('sends the session’s token, with the query encoded', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { items: [] })]);
    const http = createHttp({ session: createTokenSession({ token: 'civitai_abc' }), baseUrl: BASE, fetch });

    await expect(
      http('GET', '/images', { query: { limit: 20, tags: [1, 2], nsfw: undefined } }),
    ).resolves.toEqual({ items: [] });

    expect(calls[0]!.url).toBe(`${BASE}/images?limit=20&tags=1&tags=2`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer civitai_abc');
  });

  it('sends a body as JSON', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { id: 1 })]);
    const http = createHttp({
      session: createTokenSession({ token: 't' }),
      baseUrl: 'http://localhost:3000/api/v1/',
      fetch,
    });

    await http('POST', 'posts', { body: { title: 'hi' } });

    expect(calls[0]!.url).toBe('http://localhost:3000/api/v1/posts');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    expect(calls[0]!.body).toBe('{"title":"hi"}');
  });

  it('gets a fresh token and retries once when the token is refused', async () => {
    const { fetch, calls } = fakeFetch([() => json(401, { error: 'expired' }), () => json(200, { ok: 1 })]);
    const session = createTokenSession({ token: 'stale', refresh: () => 'fresh' });

    await expect(createHttp({ session, baseUrl: BASE, fetch })('GET', 'me')).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('gives up after the fresh token is refused too', async () => {
    const { fetch, calls } = fakeFetch([
      () => json(401, { error: 'expired' }),
      () => json(401, { error: 'Unauthorized' }),
    ]);
    const http = createHttp({ session: createTokenSession({ token: 't' }), baseUrl: BASE, fetch });

    await expect(http('GET', 'me')).rejects.toMatchObject({ status: 401, message: 'Unauthorized' });
    expect(calls).toHaveLength(2);
  });

  it('carries the status and whichever message field the server used', async () => {
    const { fetch } = fakeFetch([
      () => json(400, { error: 'limit must be <= 200' }),
      () => json(405, { message: 'Method not allowed' }),
      () => json(400, { title: 'One or more validation errors occurred.', status: 400 }),
      () => new Response('upstream down', { status: 502, statusText: 'Bad Gateway' }),
    ]);
    const http = createHttp({ session: createTokenSession({ token: 't' }), baseUrl: BASE, fetch });

    const first = await http('GET', 'images').catch((e: unknown) => e);
    expect(first).toBeInstanceOf(ApiError);
    expect(first).toBeInstanceOf(CivitaiError);
    expect(first).toMatchObject({ status: 400, message: 'limit must be <= 200' });
    await expect(http('POST', 'bugs')).rejects.toMatchObject({ message: 'Method not allowed' });
    await expect(http('POST', 'workflows')).rejects.toMatchObject({
      message: 'One or more validation errors occurred.',
    });
    await expect(http('GET', 'models')).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
      body: 'upstream down',
    });
  });

  it('resolves undefined for an empty success', async () => {
    const { fetch } = fakeFetch([() => new Response(null, { status: 204 })]);
    const http = createHttp({ session: createTokenSession({ token: 't' }), baseUrl: BASE, fetch });

    await expect(http('POST', 'collections/1/follow')).resolves.toBeUndefined();
  });
});
