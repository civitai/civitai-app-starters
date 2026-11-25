import { afterEach, describe, expect, it, vi } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { snapshotFromInit, type BlockSnapshot } from '../../src/core/transport.js';
import { StorageError } from '../../src/doc-store/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { fakeFetch, json, type FetchCall } from '../support/fake-fetch.js';
import { initPayload } from '../support/iframe-host.js';

/**
 * SERVICE MODE: the host hands the frame `appData: { url, slug }` in `BLOCK_INIT` (only for an
 * app the site has cut over to the app-data service), and `app.storage` then sends the document
 * store to that service instead of `/api/v1/blocks/storage`.
 *
 * The routes, answers and error codes are the service's (civitai/civitai#10393,
 * `apps/app-data-go/internal/api` and `internal/writes`), read from its code:
 *
 *   GET    /v1/apps/{slug}/collections/{c}/records[?keyPrefix][&author][&sort][&limit][&cursor][&minSeq]
 *   POST   /v1/apps/{slug}/collections/{c}/records                     create
 *   GET    /v1/apps/{slug}/collections/{c}/records/{key}[?minSeq]       → {source, item}
 *   PUT    /v1/apps/{slug}/collections/{c}/records/{key}               put
 *   DELETE /v1/apps/{slug}/collections/{c}/records/{key}[?ifVersion]    delete
 *   PATCH  /v1/apps/{slug}/collections/{c}/records/{key}               one update operator
 *   GET|PUT|DELETE /v1/apps/{slug}/collections/{c}/records/@me[/{parent}]
 *   GET    /v1/apps/{slug}/info
 *
 * Fixtures are pairwise distinct: the service origin, the site origin, the slug, the two block
 * tokens, every key and every seq differ, so an answer read from the wrong place, or a floor taken
 * from the wrong write, shows.
 */

const SERVICE = 'https://data.example.test';
const SLUG = 'bench-app';
const RECORDS = `${SERVICE}/v1/apps/${SLUG}/collections`;
const TOKEN = 'blk-first';
const FRESH = 'blk-second';

const APP_DATA = { url: SERVICE, slug: SLUG };

/** The fake transport takes a snapshot as is; `appData` is the field under test. */
function transport(extra: Record<string, unknown> = {}) {
  const t = createFakeTransport({
    token: { raw: TOKEN, scopes: ['apps:storage'], expiresAt: new Date('2030-01-01T00:00:00.000Z'), kind: 'block' },
    viewer: { id: 7, username: 'koen' },
    context: { slotId: 'app.page' },
    ...({ appData: APP_DATA, ...extra } as unknown as Partial<BlockSnapshot>),
  });
  t.handle('REQUEST_TOKEN', () => ({
    token: { raw: FRESH, scopes: ['apps:storage'], expiresAt: '2030-01-02T00:00:00.000Z', kind: 'block' },
  }));
  return t;
}

async function serviceApp(responses: Array<(call: FetchCall) => Response>, extra: Record<string, unknown> = {}) {
  const f = fakeFetch(responses);
  const t = transport(extra);
  const app = await initialize({ transport: t, fetch: f.fetch });
  return { app, calls: f.calls, transport: t };
}

/** A 503 the way the service sends one: the code in `error` (reads) or `code` (writes). */
const unavailable = (body: Record<string, unknown>, retryAfter?: string) =>
  new Response(JSON.stringify(body), {
    status: 503,
    headers: { 'Content-Type': 'application/json', ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }) },
  });

/** The store's document, as a write answer carries it (passed through by the service), plus `seq`. */
const STORE_DOC = (key: string, seq: number) => ({
  key,
  data: { title: `t-${key}` },
  version: 5,
  createdAt: '2026-05-06T07:08:09.010Z',
  updatedAt: '2026-05-07T08:09:10.011Z',
  author: { kind: 'user', isViewer: true },
  counters: {},
  marks: {},
  viewer: { marks: [] },
  seq,
  recordId: `rec-${key}`,
});

/** A private-collection item: key, rev, data, nothing else (`api.go` `item`). */
const PRIVATE_ITEM = (key: string) => ({ urn: `urn:apps.civitai.com:${SLUG}/kv/r-${key}`, key, rev: `rev-${key}`, data: { v: key } });

const at = (call: FetchCall) => `${call.method} ${call.url}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('the init-context field', () => {
  it('BLOCK_INIT.appData { url, slug } reaches the snapshot, copied by field', () => {
    const snap = snapshotFromInit(
      { ...initPayload(), appData: { url: SERVICE, slug: SLUG, extra: 'dropped' } } as unknown as Parameters<typeof snapshotFromInit>[0],
      'https://civitai.com',
    );
    expect((snap as { appData?: unknown }).appData).toEqual({ url: SERVICE, slug: SLUG });
  });

  it.each([
    ['a string', 'https://data.example.test'],
    ['an http URL', { url: 'http://data.example.test', slug: SLUG }],
    ['a URL with a query', { url: `${SERVICE}/?x=1`, slug: SLUG }],
    ['a URL with credentials', { url: 'https://u:p@data.example.test', slug: SLUG }],
    ['an unparseable URL', { url: 'not a url', slug: SLUG }],
    ['a slug outside the grammar', { url: SERVICE, slug: 'Bench_App' }],
    ['a missing slug', { url: SERVICE }],
    ['null', null],
  ])('a malformed appData (%s) reads as absent', (_why, appData) => {
    const snap = snapshotFromInit({ ...initPayload(), appData } as unknown as Parameters<typeof snapshotFromInit>[0], 'https://civitai.com');
    expect(Object.prototype.hasOwnProperty.call(snap, 'appData')).toBe(false);
  });

  it('INVARIANT: without appData, the document store stays on the site route', async () => {
    const f = fakeFetch([() => json(200, STORE_DOC('p1', 3))]);
    const t = createFakeTransport({
      token: { raw: TOKEN, scopes: ['apps:storage'], expiresAt: new Date('2030-01-01T00:00:00.000Z'), kind: 'block' },
      viewer: { id: 7, username: 'koen' },
    });
    const app = await initialize({ transport: t, fetch: f.fetch });
    await app.storage.collection('posts').get('p1');
    expect(f.calls.map(at)).toEqual(['GET https://civitai.com/api/v1/blocks/storage/posts/p1']);
  });
});

describe('service mode: each call goes to the service route', () => {
  it.each([
    [
      'get',
      (s: StorageApi) => s.collection('posts').get('a:b/c'),
      () => json(200, { source: 'registry', item: STORE_DOC('a:b/c', 1) }),
      ['GET', `${RECORDS}/posts/records/a%3Ab%2Fc`, undefined],
    ],
    [
      'put with ifVersion',
      (s: StorageApi) => s.collection('posts').put('p2', { title: 'x' }, { ifVersion: 4 }),
      () => json(200, STORE_DOC('p2', 11)),
      ['PUT', `${RECORDS}/posts/records/p2`, '{"data":{"title":"x"},"ifVersion":4}'],
    ],
    [
      'create',
      (s: StorageApi) => s.collection('posts').create({ title: 'y' }),
      () => json(201, STORE_DOC('01JMINTED', 12)),
      ['POST', `${RECORDS}/posts/records`, '{"data":{"title":"y"}}'],
    ],
    [
      'delete with ifVersion',
      (s: StorageApi) => s.collection('posts').delete('p3', { ifVersion: 2 }),
      () => json(200, { deleted: true, seq: 13 }),
      ['DELETE', `${RECORDS}/posts/records/p3?ifVersion=2`, undefined],
    ],
    [
      'update (PATCH)',
      (s: StorageApi) => s.collection('posts').update('p4', { $inc: { plays: 2 } }),
      () => json(200, { value: 9 }),
      ['PATCH', `${RECORDS}/posts/records/p4`, '{"$inc":{"plays":2}}'],
    ],
    [
      'getMine',
      (s: StorageApi) => s.collection('votes').getMine('rec-1'),
      () => json(200, { source: 'registry', item: { ...STORE_DOC('rec-1:abc', 1), author: { isViewer: true } } }),
      ['GET', `${RECORDS}/votes/records/@me/rec-1`, undefined],
    ],
    [
      'putMine without a parent',
      (s: StorageApi) => s.collection('prefs').putMine({ theme: 'dark' }),
      () => json(200, STORE_DOC('digest', 14)),
      ['PUT', `${RECORDS}/prefs/records/@me`, '{"data":{"theme":"dark"}}'],
    ],
    [
      'deleteMine with a parent',
      (s: StorageApi) => s.collection('votes').deleteMine({ parent: 'rec-2', ifVersion: 1 }),
      () => json(200, { deleted: true, seq: 15, key: 'rec-2:abc' }),
      ['DELETE', `${RECORDS}/votes/records/@me/rec-2?ifVersion=1`, undefined],
    ],
    [
      'list (keyPrefix, author, sort, limit, cursor)',
      (s: StorageApi) => s.collection('posts').list({ keyPrefix: 'k:', author: 'me', sort: '-key', limit: 7, cursor: 'kd~~k:9' }),
      () => json(200, { source: 'registry', items: [], nextCursor: null }),
      ['GET', `${RECORDS}/posts/records?sort=-key&author=me&keyPrefix=k%3A&limit=7&cursor=kd%7E%7Ek%3A9`, undefined],
    ],
    [
      'info',
      (s: StorageApi) => s.info(),
      () => json(200, { collections: {}, limits: {}, usage: {} }),
      ['GET', `${SERVICE}/v1/apps/${SLUG}/info`, undefined],
    ],
  ] as const)('%s', async (_name, run, answer, [method, url, body]) => {
    const { app, calls } = await serviceApp([answer]);
    await run(app.storage);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([[method, url, body]]);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('getMany: parallel keyed gets, at most 4 in flight, in the order of keys, null for a miss', async () => {
    const keys = ['k0', 'k1', 'k2', 'gone', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'];
    let inFlight = 0;
    let peak = 0;
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      const key = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
      return key === 'gone'
        ? json(404, { error: 'not_found', message: 'document not found' })
        : json(200, { source: 'registry', item: PRIVATE_ITEM(key) });
    }) as typeof globalThis.fetch;
    const app = await initialize({ transport: transport(), fetch });
    const out = await app.storage.collection('kv').getMany(keys);
    expect(out.map((d) => d?.key ?? null)).toEqual(['k0', 'k1', 'k2', null, 'k4', 'k5', 'k6', 'k7', 'k8', 'k9']);
    expect([...urls].sort()).toEqual(keys.map((k) => `${RECORDS}/kv/records/${k}`).sort());
    expect(peak).toBe(4);
  });

  it('a collection opened through an import stays on the site route', async () => {
    const { app, calls } = await serviceApp([() => json(200, STORE_DOC('p1', 3))]);
    await app.storage.collection('notes', { from: 'parent-app' }).get('p1');
    expect(calls.map(at)).toEqual(['GET https://civitai.com/api/v1/blocks/storage/notes/p1?from=parent-app']);
  });

  it('a list filter the service cannot serve (where, mark, another sort) is refused before sending, not_supported_here', async () => {
    const { app, calls } = await serviceApp([]);
    const posts = app.storage.collection('posts');
    for (const query of [{ where: { status: 'open' } }, { markedBy: 'me' as const, mark: 'vote' }, { sort: 'createdAt' }]) {
      const error = (await posts.list(query).catch((e: unknown) => e)) as StorageError;
      expect(error).toBeInstanceOf(StorageError);
      expect(error.code).toBe('not_supported_here');
      expect(error.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

describe('service mode: reading the answers', () => {
  it('a private item (key, rev, data only) reads as the viewer\'s own document at version 0', async () => {
    const { app } = await serviceApp([() => json(200, { source: 'registry', item: PRIVATE_ITEM('note-1') })]);
    const doc = await app.storage.collection('kv').get('note-1');
    expect(doc).toEqual({
      key: 'note-1',
      data: { v: 'note-1' },
      version: 0,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      author: { kind: 'user', isViewer: true },
      counters: {},
      marks: {},
      viewer: { marks: [] },
    });
  });

  it('a shared item whose author has no kind reads as a user, isViewer as sent', async () => {
    const item = {
      urn: 'urn:x',
      key: 'r9',
      rev: 'rv',
      data: { t: 1 },
      version: 6,
      createdAt: '2026-03-04T05:06:07.008Z',
      updatedAt: '2026-03-05T06:07:08.009Z',
      author: { isViewer: false },
    };
    const { app } = await serviceApp([() => json(200, { source: 'registry', item })]);
    const doc = await app.storage.collection('records').get('r9');
    expect(doc).toMatchObject({ key: 'r9', version: 6, author: { kind: 'user', isViewer: false } });
    expect(doc!.updatedAt.getTime()).toBe(Date.parse(item.updatedAt));
  });

  it('an author that is not an object, or a kind this SDK does not know, still throws', async () => {
    const { app } = await serviceApp([
      () => json(200, { source: 'registry', item: { ...PRIVATE_ITEM('a'), author: { kind: 'robot' } } }),
      () => json(200, { source: 'registry', item: { ...PRIVATE_ITEM('b'), author: 'me' } }),
    ]);
    await expect(app.storage.collection('kv').get('a')).rejects.toThrow(/author/);
    await expect(app.storage.collection('kv').get('b')).rejects.toThrow(/author/);
  });

  it('a private list (no nextCursor: the whole collection) is the last page, in key order', async () => {
    const items = [PRIVATE_ITEM('m'), PRIVATE_ITEM('b'), PRIVATE_ITEM('x')];
    const { app } = await serviceApp([
      () => json(200, { source: 'registry', items }),
      () => json(200, { source: 'registry', items }),
    ]);
    const up = await app.storage.collection('kv').list();
    expect(up.items.map((d) => d.key)).toEqual(['b', 'm', 'x']);
    expect(up.nextCursor).toBeNull();
    const down = await app.storage.collection('kv').list({ sort: '-key' });
    expect(down.items.map((d) => d.key)).toEqual(['x', 'm', 'b']);
  });

  it('a shared list keeps its order and passes nextCursor through', async () => {
    const a = { ...STORE_DOC('z', 1), author: { isViewer: true } };
    const b = { ...STORE_DOC('c', 2), author: { isViewer: false } };
    const { app } = await serviceApp([() => json(200, { source: 'registry', items: [a, b], nextCursor: 'ka~~c' })]);
    const page = await app.storage.collection('records').list({ limit: 2 });
    expect(page.items.map((d) => d.key)).toEqual(['z', 'c']);
    expect(page.nextCursor).toBe('ka~~c');
  });

  it('get: the service\'s 404 not_found (code in `error`) is null; getMine: its "document not found" is null', async () => {
    const { app } = await serviceApp([
      () => json(404, { error: 'not_found', message: 'document not found' }),
      () => json(404, { error: 'not_found', code: 'not_found', message: 'document not found' }),
    ]);
    expect(await app.storage.collection('kv').get('none')).toBeNull();
    expect(await app.storage.collection('votes').getMine('rec-7')).toBeNull();
  });

  it('a refusal whose code is only in `error` is a StorageError with that code', async () => {
    const { app } = await serviceApp([() => json(501, { error: 'not_private', message: 'this collection is not served here' })]);
    const error = (await app.storage.collection('kv').get('k').catch((e: unknown) => e)) as StorageError;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe('not_private');
    expect(error.status).toBe(501);
    expect(error.message).toBe('this collection is not served here');
  });
});

describe('service mode: read-your-writes floor (minSeq)', () => {
  it('reads carry the highest seq a write answer named; a lower one, a read and a seq-less answer never move it', async () => {
    const { app, calls } = await serviceApp([
      () => json(200, { source: 'registry', item: PRIVATE_ITEM('r0') }), // read: no floor yet
      () => json(200, STORE_DOC('w1', 41)), // put → 41
      () => json(200, { source: 'registry', item: { ...PRIVATE_ITEM('r1'), seq: 990 } }), // a read's seq: ignored
      () => json(201, STORE_DOC('w2', 57)), // create in another collection → 57
      () => json(200, { deleted: true, seq: 12 }), // lower: stays 57
      () => json(200, { deleted: false }), // no seq: stays 57
      () => json(200, { source: 'registry', items: [] }), // list
      () => json(200, { source: 'registry', item: STORE_DOC('mine', 1) }), // getMine
      () => json(200, { collections: {}, limits: {}, usage: {} }), // info: never a floor
    ]);
    const kv = app.storage.collection('kv');
    await kv.get('r0');
    await kv.put('w1', { v: 1 });
    await kv.get('r1');
    await app.storage.collection('posts').create({ title: 'n' });
    await kv.delete('w1');
    await kv.delete('nothing');
    await kv.list({ keyPrefix: 'p' });
    await app.storage.collection('votes').getMine('rec-3');
    await app.storage.info();
    expect(calls.map(at)).toEqual([
      `GET ${RECORDS}/kv/records/r0`,
      `PUT ${RECORDS}/kv/records/w1`,
      `GET ${RECORDS}/kv/records/r1?minSeq=41`,
      `POST ${RECORDS}/posts/records`,
      `DELETE ${RECORDS}/kv/records/w1`,
      `DELETE ${RECORDS}/kv/records/nothing`,
      `GET ${RECORDS}/kv/records?keyPrefix=p&minSeq=57`,
      `GET ${RECORDS}/votes/records/@me/rec-3?minSeq=57`,
      `GET ${SERVICE}/v1/apps/${SLUG}/info`,
    ]);
  });

  it.each([['a fraction', 41.5], ['zero', 0], ['negative', -3], ['a string', '41'], ['above 2^53', 2 ** 53 + 2]])(
    'a write answer whose seq is %s does not raise the floor',
    async (_why, seq) => {
      const { app, calls } = await serviceApp([
        () => json(200, { ...STORE_DOC('w', 1), seq }),
        () => json(200, { source: 'registry', item: PRIVATE_ITEM('r') }),
      ]);
      await app.storage.collection('kv').put('w', { v: 1 });
      await app.storage.collection('kv').get('r');
      expect(calls[1]!.url).toBe(`${RECORDS}/kv/records/r`);
    },
  );
});

describe('service mode: retries', () => {
  it('a read answered 503 with Retry-After is retried, the same request', async () => {
    const { app, calls } = await serviceApp([
      () => unavailable({ error: 'floor_not_met', message: 'retry' }, '0'),
      () => json(200, { source: 'registry', item: PRIVATE_ITEM('k') }),
    ]);
    expect((await app.storage.collection('kv').get('k'))?.key).toBe('k');
    expect(calls.map(at)).toEqual([`GET ${RECORDS}/kv/records/k`, `GET ${RECORDS}/kv/records/k`]);
  });

  it('retries are bounded: 3, then the 503 surfaces as a StorageError', async () => {
    const { app, calls } = await serviceApp(
      Array.from({ length: 6 }, () => () => unavailable({ error: 'not_live', message: 'retry' }, '0')),
    );
    const error = (await app.storage.collection('kv').get('k').catch((e: unknown) => e)) as StorageError;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe('not_live');
    expect(error.status).toBe(503);
    expect(calls).toHaveLength(4);
  });

  it('a 503 without Retry-After, or one asking for more than 5 s, is not retried', async () => {
    const { app, calls } = await serviceApp([
      () => unavailable({ error: 'capacity', message: 'x' }),
      () => unavailable({ error: 'capacity', message: 'x' }, '6'),
      () => unavailable({ error: 'capacity', message: 'x' }, 'soon'),
    ]);
    const kv = app.storage.collection('kv');
    await expect(kv.get('a')).rejects.toMatchObject({ code: 'capacity' });
    await expect(kv.get('b')).rejects.toMatchObject({ code: 'capacity' });
    await expect(kv.get('c')).rejects.toMatchObject({ code: 'capacity' });
    expect(calls).toHaveLength(3);
  });

  it('waits the Retry-After before the retry', async () => {
    vi.useFakeTimers();
    const { app, calls } = await serviceApp([
      () => unavailable({ error: 'cooling_down', message: 'x' }, '2'),
      () => json(200, { source: 'registry', item: PRIVATE_ITEM('k') }),
    ]);
    const pending = app.storage.collection('kv').get('k');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)?.key).toBe('k');
    expect(calls).toHaveLength(2);
  });

  it('a write is resent on 503 not_forwarded, the same body', async () => {
    const { app, calls } = await serviceApp([
      () => unavailable({ code: 'not_forwarded', message: 'resend', error: 'resend' }, '0'),
      () => json(200, STORE_DOC('p', 21)),
    ]);
    await app.storage.collection('posts').put('p', { title: 'same' });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PUT', `${RECORDS}/posts/records/p`, '{"data":{"title":"same"}}'],
      ['PUT', `${RECORDS}/posts/records/p`, '{"data":{"title":"same"}}'],
    ]);
  });

  it.each([
    ['another code', { code: 'busy', message: 'x', error: 'x' }],
    ['no code (a proxy)', { message: 'Service Unavailable' }],
    ['the code only in `error`', { error: 'not_forwarded', message: 'x' }],
  ])('a write answered 503 with Retry-After but %s is never resent', async (_why, body) => {
    const { app, calls } = await serviceApp([() => unavailable(body, '0'), () => json(200, STORE_DOC('n', 1))]);
    await expect(app.storage.collection('posts').create({ title: 'once' })).rejects.toBeInstanceOf(Error);
    expect(calls).toHaveLength(1);
  });

  it('504 outcome_unknown is never retried, read or write, and surfaces its code', async () => {
    const unknown = () =>
      json(504, { code: 'outcome_unknown', outcome: 'unknown', message: 'lost', error: 'lost' });
    const { app, calls } = await serviceApp([unknown, unknown, () => json(200, {})]);
    const write = (await app.storage.collection('posts').create({ title: 'x' }).catch((e: unknown) => e)) as StorageError;
    expect(write).toBeInstanceOf(StorageError);
    expect(write.code).toBe('outcome_unknown');
    expect(write.status).toBe(504);
    await expect(app.storage.collection('posts').delete('d')).rejects.toMatchObject({ code: 'outcome_unknown' });
    expect(calls).toHaveLength(2);
  });

  it('401 block_token_spent gets a fresh block token from the host and sends the read again', async () => {
    const { app, calls, transport: t } = await serviceApp([
      () => json(401, { error: 'block_token_spent', message: 'the token cannot read this stream' }),
      () => json(200, { source: 'registry', item: PRIVATE_ITEM('k') }),
    ]);
    expect((await app.storage.collection('kv').get('k'))?.key).toBe('k');
    expect(calls.map((c) => [at(c), c.headers.Authorization])).toEqual([
      [`GET ${RECORDS}/kv/records/k`, `Bearer ${TOKEN}`],
      [`GET ${RECORDS}/kv/records/k`, `Bearer ${FRESH}`],
    ]);
    expect(t.sent.filter((m) => m.type === 'REQUEST_TOKEN')).toHaveLength(1);
  });
});

type StorageApi = Awaited<ReturnType<typeof initialize>>['storage'];
