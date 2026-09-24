import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import { ApiError } from '../../src/http/index.js';
import { isQuotaRefusal, type StorageClient } from '../../src/storage/index.js';
import { createFakeAppStorage, type FakeAppStorage } from '../../src/testing.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const BASE = 'https://civitai.com/api/v1';
const ROUTE = '/api/v1/blocks/app-storage';

/**
 * The seam is `fetch`. Everything below drives the REAL client — its URLs, its
 * bodies, its status handling and its date revival — against a fake server.
 */
async function storageOf(fake: FakeAppStorage, refresh?: () => string): Promise<StorageClient> {
  const app = await initialize({ token: 'block-jwt-1', refresh, fetch: fake.fetch });
  return app.storage;
}

/** Pairwise distinct, and distinct from every constant an assertion names. */
const STAMPS = {
  alpha: new Date('2026-03-04T05:06:07.008Z'),
  beta: new Date('2026-07-08T09:10:11.012Z'),
} as const;

describe('AppClient.storage — routes and bodies', () => {
  it('posts each op under the site base URL, carrying the key in the body', async () => {
    const fake = createFakeAppStorage({ seed: [{ key: 'draft:1', value: { n: 7 } }] });
    const storage = await storageOf(fake);

    await expect(storage.get('draft:1')).resolves.toEqual({ n: 7 });
    await storage.set('draft:2', 'hello');
    await storage.delete('draft:1');
    await storage.list({ prefix: 'draft:' });
    await storage.getQuota();

    expect(fake.calls.map((c) => c.path)).toEqual([
      `${ROUTE}/get`,
      `${ROUTE}/set`,
      `${ROUTE}/delete`,
      `${ROUTE}/list`,
      `${ROUTE}/quota`,
    ]);
    expect(fake.calls[0]!.body).toEqual({ key: 'draft:1' });
    expect(fake.calls[1]!.body).toEqual({ key: 'draft:2', value: 'hello' });
    expect(fake.calls[2]!.body).toEqual({ key: 'draft:1' });
    expect(fake.calls[3]!.body).toEqual({ prefix: 'draft:' });
    expect(fake.calls[4]!.body).toEqual({});
  });

  it('follows a `siteUrl` override, so a dev harness redirects storage too', async () => {
    const fake = createFakeAppStorage();
    const urls: string[] = [];
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return fake.fetch(input, init);
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 't', siteUrl: 'http://localhost:3000/api/v1', fetch });
    await app.storage.getQuota();

    expect(urls).toEqual(['http://localhost:3000/api/v1/blocks/app-storage/quota']);
  });
});

describe('AppClient.storage — get', () => {
  it('resolves the value, and `null` for a key that is unset', async () => {
    const storage = await storageOf(createFakeAppStorage({ seed: [{ key: 'a', value: [1, 2] }] }));

    await expect(storage.get('a')).resolves.toEqual([1, 2]);
    await expect(storage.get('missing')).resolves.toBeNull();
  });

  it('🔴 throws on a 2xx that carried no `value` — `null` means unset, not unreadable', async () => {
    const { fetch } = fakeFetch([() => json(200, { notValue: 1 })]);
    const storage = await storageOf({ fetch, calls: [], rows: () => [] });

    const error = await storage.get('a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CivitaiError);
    expect((error as Error).message).toMatch(/get: reply carried no `value`/);
  });
});

describe('AppClient.storage — set', () => {
  it('resolves `{ok, sizeBytes}` and writes the value the caller passed', async () => {
    const fake = createFakeAppStorage();
    const storage = await storageOf(fake);

    // 'hello' serialises to 7 bytes with its quotes.
    await expect(storage.set('k', 'hello')).resolves.toEqual({ ok: true, sizeBytes: 7 });
    expect(fake.rows().map((r) => r.value)).toEqual(['hello']);
  });

  it('throws on a 2xx that carried no `sizeBytes`, rather than declaring a number it never saw', async () => {
    const { fetch } = fakeFetch([() => json(200, { ok: true })]);
    const storage = await storageOf({ fetch, calls: [], rows: () => [] });

    await expect(storage.set('k', 1)).rejects.toThrow(/set: reply carried no `sizeBytes`/);
  });

  it('🔴 a refused write rejects — it never resolves a soft failure', async () => {
    const fake = createFakeAppStorage({
      refuse: [{ status: 413, body: { message: 'per-user storage quota exceeded' } }],
    });
    const storage = await storageOf(fake);

    const error = await storage.set('k', 'v').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(413);
    expect(isQuotaRefusal(error)).toBe(true);
    // Positive control on the predicate: it is not simply always true.
    expect(isQuotaRefusal(new ApiError(403, 'no', {}))).toBe(false);
    expect(isQuotaRefusal(new Error('network'))).toBe(false);
  });
});

describe('AppClient.storage — delete', () => {
  it('reports `deleted: false` for an absent key as a success', async () => {
    const storage = await storageOf(createFakeAppStorage({ seed: [{ key: 'a', value: 1 }] }));

    await expect(storage.delete('a')).resolves.toEqual({ ok: true, deleted: true });
    await expect(storage.delete('a')).resolves.toEqual({ ok: true, deleted: false });
  });

  it('throws when the reply carried no `deleted` flag', async () => {
    const { fetch } = fakeFetch([() => json(200, { ok: true })]);
    const storage = await storageOf({ fetch, calls: [], rows: () => [] });

    await expect(storage.delete('a')).rejects.toThrow(/delete: reply carried no `deleted` flag/);
  });
});

describe('AppClient.storage — list', () => {
  it('revives `updatedAt` to a Date carrying the seeded millisecond', async () => {
    const storage = await storageOf(
      createFakeAppStorage({ seed: [{ key: 'a', value: 1, updatedAt: STAMPS.alpha }] }),
    );

    const { keys } = await storage.list();
    expect(keys[0]!.updatedAt).toBeInstanceOf(Date);
    expect(keys[0]!.updatedAt.getTime()).toBe(STAMPS.alpha.getTime());
  });

  it('🔴 throws on a malformed 200 — it never manufactures an empty page', async () => {
    const { fetch } = fakeFetch([
      () => json(200, { nextCursor: 'abc' }),
      () => json(200, { keys: [{ key: 'a' }] }),
      () => json(200, { keys: [{ key: 'a', updatedAt: null }] }),
      () => json(200, { keys: [{ updatedAt: STAMPS.beta.toISOString() }] }),
    ]);
    const storage = await storageOf({ fetch, calls: [], rows: () => [] });

    const noKeys = await storage.list().catch((e: unknown) => e);
    expect(noKeys).toBeInstanceOf(CivitaiError);
    expect((noKeys as Error).message).toMatch(/list: reply carried no `keys` array/);

    await expect(storage.list()).rejects.toThrow(/malformed key entry/);
    // `new Date(null)` is the epoch, not Invalid Date — so a null stamp must be
    // refused by its own check, not left to the NaN one.
    await expect(storage.list()).rejects.toThrow(/malformed key entry/);
    await expect(storage.list()).rejects.toThrow(/malformed key entry/);
  });

  it('passes `nextCursor` through untouched, and omits it on the last page', async () => {
    const fake = createFakeAppStorage({
      pageSize: 2,
      seed: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'c', value: 3 },
      ],
    });
    const storage = await storageOf(fake);

    const first = await storage.list();
    expect(first.keys.map((k) => k.key)).toEqual(['a', 'b']);
    expect(typeof first.nextCursor).toBe('string');

    const last = await storage.list({ cursor: first.nextCursor });
    expect(last.keys.map((k) => k.key)).toEqual(['c']);
    // Absence is the caller's proof the scan completed. Not `''`, not `null`.
    expect(last.nextCursor).toBeUndefined();
  });

  it('🔴 sends the cursor it was handed, so a row only on page 2 is reachable', async () => {
    const fake = createFakeAppStorage({
      pageSize: 2,
      seed: [
        { key: 'inflight:a', value: 1 },
        { key: 'inflight:b', value: 2 },
        // Reachable ONLY on page 2. A client that drops `cursor` re-reads page 1.
        { key: 'inflight:z', value: 3 },
      ],
    });
    const storage = await storageOf(fake);

    const first = await storage.list({ prefix: 'inflight:' });
    const second = await storage.list({ prefix: 'inflight:', cursor: first.nextCursor });

    expect(second.keys.map((k) => k.key)).toEqual(['inflight:z']);
    // The half a client-mocking suite cannot see: what the CLIENT sent.
    expect(fake.calls[0]!.body.cursor).toBeUndefined();
    expect(fake.calls[1]!.body.cursor).toBe(first.nextCursor);
  });

  it('forwards `limit`, so a caller can over-fetch past the fake’s page size', async () => {
    const fake = createFakeAppStorage({
      pageSize: 3,
      seed: [1, 2, 3, 4, 5].map((n) => ({ key: `k${n}`, value: n })),
    });
    const storage = await storageOf(fake);

    const { keys } = await storage.list({ limit: 5 });
    expect(keys).toHaveLength(5);
    expect(fake.calls[0]!.body.limit).toBe(5);
  });

  it('forwards `prefix`, so the other prefix’s keys stay absent', async () => {
    const fake = createFakeAppStorage({
      pageSize: 10,
      seed: [
        { key: 'draft:1', value: 1 },
        { key: 'inflight:1', value: 2 },
      ],
    });
    const storage = await storageOf(fake);

    const { keys } = await storage.list({ prefix: 'draft:' });
    expect(keys.map((k) => k.key)).toEqual(['draft:1']);
    expect(fake.calls[0]!.body.prefix).toBe('draft:');
  });

  it('sends no limit of its own when the caller gave none', async () => {
    const fake = createFakeAppStorage();
    const storage = await storageOf(fake);

    await storage.list();
    expect(fake.calls[0]!.body).toEqual({});
    expect('limit' in fake.calls[0]!.body).toBe(false);
  });

  it('pages to exhaustion within a bound — and the pair of read counts', async () => {
    const scan = async (storage: StorageClient) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      const MAX_PAGES = 20;
      do {
        const page = await storage.list({ cursor });
        for (const k of page.keys) seen.push(k.key);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      return { seen, pages, truncated: Boolean(cursor) };
    };

    // Truncated first page ⇒ exactly one EXTRA read after it.
    const multi = createFakeAppStorage({
      pageSize: 2,
      seed: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'c', value: 3 },
      ],
    });
    const many = await scan(await storageOf(multi));
    expect(many.seen).toEqual(['a', 'b', 'c']);
    expect(many.truncated).toBe(false);
    expect(multi.calls.length - 1).toBe(1);

    // The paired zero: a first page that was not full costs no extra read.
    const single = createFakeAppStorage({ pageSize: 2, seed: [{ key: 'a', value: 1 }] });
    const one = await scan(await storageOf(single));
    expect(one.seen).toEqual(['a']);
    expect(one.truncated).toBe(false);
    expect(single.calls.length - 1).toBe(0);
  });
});

describe('AppClient.storage — an anonymous viewer is refused, not answered empty', () => {
  it('🔴 rejects `get` and `list` rather than resolving null / []', async () => {
    const anon = createFakeAppStorage({ viewer: null, seed: [{ key: 'a', value: 1 }] });
    const storage = await storageOf(anon);

    const listed = await storage.list().catch((e: unknown) => e);
    expect(listed).toBeInstanceOf(ApiError);
    expect((listed as ApiError).status).toBe(403);
    expect((listed as ApiError).message).toBe('apps:storage:read requires authenticated subject');

    await expect(storage.get('a')).rejects.toMatchObject({ status: 403 });
    await expect(storage.set('a', 1)).rejects.toMatchObject({ status: 403 });

    // Positive control: the same fixture, signed in, resolves a NON-EMPTY page —
    // so the rejection above is the viewer check and not a fake wired to nothing.
    const signedIn = await storageOf(createFakeAppStorage({ seed: [{ key: 'a', value: 1 }] }));
    await expect(signedIn.list()).resolves.toMatchObject({ keys: [{ key: 'a' }] });
  });
});

describe('AppClient.storage — token refresh', () => {
  it('retries a 401 exactly once, with a different bearer', async () => {
    const fake = createFakeAppStorage({
      seed: [{ key: 'a', value: 1 }],
      refuse: [{ status: 401, body: { message: 'invalid block token' } }],
    });
    const storage = await storageOf(fake, () => 'block-jwt-2');

    await expect(storage.get('a')).resolves.toBe(1);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.map((c) => c.token)).toEqual(['block-jwt-1', 'block-jwt-2']);
  });

  it('gives up after the fresh token is refused too — it does not retry twice', async () => {
    const fake = createFakeAppStorage({
      refuse: [
        { status: 401, body: { message: 'invalid block token' } },
        { status: 401, body: { message: 'invalid block token' } },
        { status: 401, body: { message: 'invalid block token' } },
      ],
    });
    const storage = await storageOf(fake, () => 'block-jwt-2');

    await expect(storage.get('a')).rejects.toMatchObject({ status: 401 });
    expect(fake.calls).toHaveLength(2);
  });
});

describe('AppClient.storage — quota', () => {
  it('reports the viewer’s own usage and both ceilings', async () => {
    const fake = createFakeAppStorage({
      seed: [
        { key: 'a', value: 'x' },
        { key: 'b', value: 'yy' },
      ],
    });
    const storage = await storageOf(fake);

    const quota = await storage.getQuota();
    expect(quota.rowCount).toBe(2);
    expect(quota.usedBytes).toBe(7); // '"x"' + '"yy"'
    expect(quota.limitBytes).toBeGreaterThan(0);
    expect(quota.limitRows).toBeGreaterThan(0);
  });
});

describe('AppClient.storage — abort', () => {
  it('passes the caller’s signal down to fetch', async () => {
    const controller = new AbortController();
    // Models `fetch`: an already-aborted signal rejects at once, and one that
    // aborts later rejects then. The client reaches this only after awaiting the
    // token, so which arm fires is a timing detail the test must not depend on.
    const fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.signal?.aborted) throw init.signal.reason;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    }) as typeof globalThis.fetch;
    const storage = await storageOf({ fetch, calls: [], rows: () => [] });

    const pending = storage.list({}, { signal: controller.signal });
    controller.abort(new Error('caller went away'));
    await expect(pending).rejects.toThrow('caller went away');
  });
});

describe('the fake itself', () => {
  it('🔴 puts an ISO STRING on the wire, which is what makes the revival observable', async () => {
    const fake = createFakeAppStorage({ seed: [{ key: 'a', value: 1, updatedAt: STAMPS.beta }] });
    const raw = await fake.fetch(`${BASE}/blocks/app-storage/list`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: '{}',
    });
    const wire = (await raw.json()) as { keys: { updatedAt: unknown }[] };

    expect(typeof wire.keys[0]!.updatedAt).toBe('string');
    expect(wire.keys[0]!.updatedAt).toBe(STAMPS.beta.toISOString());

    // The pair, and the reason the rule exists: had the wire carried a `Date`,
    // reviving it would be a no-op, so deleting `new Date(...)` in the client
    // would survive a fully green suite. This is that no-op, asserted.
    expect(new Date(STAMPS.beta).getTime()).toBe(STAMPS.beta.getTime());
  });

  it('gives seeded rows pairwise-distinct stamps when none was supplied', async () => {
    const fake = createFakeAppStorage({
      pageSize: 10,
      seed: [
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'c', value: 3 },
      ],
    });
    const stamps = fake.rows().map((r) => r.updatedAt.getTime());
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it('refuses a route it does not serve, so a wrong path cannot look like a refusal', async () => {
    const fake = createFakeAppStorage();
    await expect(
      fake.fetch(`${BASE}/blocks/app_storage/get`, { method: 'POST', body: '{}' }),
    ).rejects.toThrow(/no route for/);
  });
});
