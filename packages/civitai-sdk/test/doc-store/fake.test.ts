import { describe, expect, it } from 'vitest';

import { StorageError } from '../../src/doc-store/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';

/**
 * The fake's rules the contract does not reach: the shared write budget, the
 * window resets, sorts and filters beyond one case, byte quotas, deferred
 * features refused at use, and the manifest it is built from. Each expectation is
 * ported from the server source (`doc-store-api.ts`, `doc-store.ts`,
 * `shared-storage-rate-limit.ts` on civitai `main`), not read back from the fake.
 */

const SCOPES = ['apps:storage', 'apps:storage:publish'];
const COLLECTIONS = {
  prefs: { visibility: 'private' },
  posts: {
    visibility: 'shared',
    write: 'own',
    marks: ['vote'],
    counters: ['views'],
    indexes: { status: 'string', rank: 'number', open: 'boolean', due: 'time' },
    showAuthor: true,
  },
  plays: { visibility: 'shared', write: 'none', counters: ['plays'] },
};

function make(extra: Partial<FakeStorageOptions> = {}, collections: Record<string, unknown> = COLLECTIONS) {
  let t = Date.parse('2031-01-01T00:00:00.000Z');
  const clock = {
    advance: (ms: number) => {
      t += ms;
    },
  };
  const fake = createFakeStorage({
    manifest: { scopes: SCOPES, storage: { collections } },
    viewer: { username: 'alice', id: 910_001 },
    now: () => t,
    ...extra,
  });
  return { fake, clock };
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(StorageError);
      return e as StorageError;
    },
  );

describe('the manifest', () => {
  it('refuses a malformed declaration at construction', () => {
    expect(() => make({}, { Bad: { visibility: 'private' } })).toThrow(/invalid collection name/);
    expect(() => make({}, { p: { visibility: 'private', write: 'own' } })).toThrow(/write applies only to shared/);
    expect(() => make({}, { p: { visibility: 'shared', write: 'own', marks: ['report'] } })).toThrow(/invalid name report/);
    expect(() => make({}, { p: { visibility: 'shared', write: 'none' } })).toThrow(/at least one counter or mark/);
    expect(() => make({}, { p: { visibility: 'shared', write: 'own', indexes: { key: 'string' } } })).toThrow(/invalid path key/);
  });

  it.each([
    ['write "anyone"', { visibility: 'shared', write: 'anyone' }],
    ['ttlSeconds', { visibility: 'private', ttlSeconds: 3600 }],
    ['kind "log"', { visibility: 'private', kind: 'log' }],
    ['dailyWritesPerAuthor', { visibility: 'shared', write: 'own', dailyWritesPerAuthor: 5 }],
  ])('a collection using a deferred feature (%s) is refused at use; the others keep working', async (_what, decl) => {
    const { fake } = make({}, { later: decl, prefs: { visibility: 'private' } });
    const e = await refusal(fake.storage.collection('later').put('k', {}));
    expect(e.code).toBe('invalid_request');
    expect(e.details).toEqual({ collection: 'later' });
    await expect(fake.storage.collection('prefs').put('k', {})).resolves.toMatchObject({ version: 1 });
  });

  it('a manifest without storage declares nothing', async () => {
    const fake = createFakeStorage({ manifest: { scopes: ['apps:storage'] } });
    expect((await refusal(fake.storage.collection('prefs').list())).code).toBe('collection_not_declared');
  });
});

describe('the shared write budget', () => {
  it('ten writes, then refused until one burst token refills (6 minutes)', async () => {
    const { fake, clock } = make();
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 10; i++) await posts.put(`p${i}`, {});
    const e = await refusal(posts.put('p10', {}));
    expect(e.code).toBe('rate_limited');
    expect(e.details).toEqual({ bucket: 'shared-write', retryAfter: 360 });
    clock.advance(359_000);
    expect((await refusal(posts.put('p10', {}))).details?.retryAfter).toBe(1);
    clock.advance(1_000);
    await expect(posts.put('p10', {})).resolves.toMatchObject({ key: 'p10' });
    // Private writes and deletes spend other buckets.
    await expect(fake.storage.collection('prefs').put('k', {})).resolves.toBeTruthy();
    await expect(posts.delete('p0')).resolves.toEqual({ deleted: true });
  });

  it('a refused write gives its token back but spends a rejection; ten rejections lock writes', async () => {
    const { fake } = make();
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 10; i++) {
      expect((await refusal(posts.put(`p${i}`, { t: 'contract-blocked-term' }))).code).toBe('content_rejected');
    }
    // The burst bucket is full (every token came back) — the rejection bucket is not.
    const e = await refusal(posts.put('ok', {}));
    expect(e.details).toEqual({ bucket: 'shared-write', retryAfter: 1800 });
  });

  it('an outage (moderation unavailable) is refunded without a rejection', async () => {
    const { fake } = make();
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 12; i++) {
      expect((await refusal(posts.put(`p${i}`, { t: 'contract-scanner-down' }))).code).toBe('moderation_unavailable');
    }
    await expect(posts.put('ok', {})).resolves.toMatchObject({ key: 'ok' });
  });

  it('per viewer: one viewer exhausting it leaves another untouched', async () => {
    const { fake } = make();
    for (let i = 0; i < 10; i++) await fake.storage.collection('posts').put(`a${i}`, {});
    await expect(fake.storage.collection('posts').put('a10', {})).rejects.toMatchObject({ code: 'rate_limited' });
    const bob = fake.as({ viewer: { username: 'bob' } }).storage;
    await expect(bob.collection('posts').put('b0', {})).resolves.toMatchObject({ key: 'b0' });
  });
});

describe('fixed windows', () => {
  it('marks and counters: 30 a minute from the first, every request counted, then a fresh window', async () => {
    const { fake, clock } = make();
    await fake.storage.collection('posts').put('p', {});
    for (let i = 0; i < 30; i++) await fake.storage.collection('plays').increment('m', 'plays');
    clock.advance(20_000);
    const e = await refusal(fake.storage.collection('posts').mark('p', 'vote'));
    expect(e.details).toEqual({ bucket: 'tally', retryAfter: 40 });
    clock.advance(40_000);
    await expect(fake.storage.collection('posts').mark('p', 'vote')).resolves.toEqual({ marked: true, count: 1 });
  });

  it('reads: 300 a minute; anonymous readers share one (client IP) window', async () => {
    const { fake } = make();
    const anon = fake.as({ viewer: null }).storage.collection('posts');
    for (let i = 0; i < 300; i++) await anon.list();
    expect((await refusal(anon.list())).details).toMatchObject({ bucket: 'read' });
    await expect(fake.storage.collection('posts').list()).resolves.toMatchObject({ items: [] });
  });
});

describe('lists', () => {
  async function seeded() {
    const { fake, clock } = make();
    const posts = fake.storage.collection('posts');
    const bob = fake.as({ viewer: { username: 'bob', id: 910_002 } }).storage.collection('posts');
    await posts.put('a:1', { status: 'open', rank: 2, open: true, due: '2031-02-01T00:00:00Z' });
    clock.advance(10);
    await bob.put('a:2', { status: 'closed', rank: 10, open: false, due: 1_900_000_000_000 });
    clock.advance(10);
    await posts.put('b:1', { status: 'open', rank: -1 });
    await bob.mark('a:1', 'vote');
    await posts.mark('b:1', 'vote');
    for (let i = 0; i < 3; i++) await posts.increment('a:2', 'views');
    return { fake, posts, bob };
  }
  const keys = async (p: Promise<{ items: { key: string }[] }>) => (await p).items.map((d) => d.key);

  it('filters by a typed index: string, number, boolean, time', async () => {
    const { posts } = await seeded();
    expect(await keys(posts.list({ where: { status: 'open' } }))).toEqual(['a:1', 'b:1']);
    expect(await keys(posts.list({ where: { rank: 10 } }))).toEqual(['a:2']);
    expect(await keys(posts.list({ where: { open: false } }))).toEqual(['a:2']);
    expect(await keys(posts.list({ where: { due: new Date('2031-02-01T00:00:00Z') } }))).toEqual(['a:1']);
    expect(await keys(posts.list({ where: { due: 1_900_000_000_000 } }))).toEqual(['a:2']);
    expect((await refusal(posts.list({ where: { rank: 'ten' } }))).code).toBe('invalid_request');
    expect((await refusal(posts.list({ where: { status: 'open', rank: 2 } }))).code).toBe('invalid_request');
  });

  it('sorts by an index (documents without it are not listed), a tally (absent = 0) and createdAt', async () => {
    const { posts } = await seeded();
    expect(await keys(posts.list({ sort: 'rank' }))).toEqual(['b:1', 'a:1', 'a:2']);
    expect(await keys(posts.list({ sort: '-due' }))).toEqual(['a:1', 'a:2']);
    // Ties break on the key, in the same direction as the sort.
    expect(await keys(posts.list({ sort: '-counter:views' }))).toEqual(['a:2', 'b:1', 'a:1']);
    expect(await keys(posts.list({ sort: '-mark:vote' }))).toEqual(['b:1', 'a:1', 'a:2']);
    expect(await keys(posts.list({ sort: '-createdAt' }))).toEqual(['b:1', 'a:2', 'a:1']);
    expect((await refusal(posts.list({ sort: 'mark:report' }))).code).toBe('index_not_declared');
  });

  it('keyPrefix, author=me, markedBy=me', async () => {
    const { posts, bob } = await seeded();
    expect(await keys(posts.list({ keyPrefix: 'a:' }))).toEqual(['a:1', 'a:2']);
    expect(await keys(posts.list({ author: 'me' }))).toEqual(['a:1', 'b:1']);
    expect(await keys(bob.list({ markedBy: 'me', mark: 'vote' }))).toEqual(['a:1']);
    expect((await refusal(posts.list({ markedBy: 'me' }))).code).toBe('invalid_request');
  });

  it('a cursor is bound to its sort', async () => {
    const { posts } = await seeded();
    const { nextCursor } = await posts.list({ sort: 'rank', limit: 1 });
    expect(nextCursor).toMatch(/^na~/);
    expect((await refusal(posts.list({ sort: 'key', cursor: nextCursor! }))).code).toBe('invalid_request');
    expect((await refusal(posts.list({ cursor: 'garbage' }))).code).toBe('invalid_request');
  });
});

describe('documents', () => {
  it('authors: isViewer per reader, username only under showAuthor, never an id', async () => {
    const { fake } = make();
    await fake.storage.collection('posts').put('p', {});
    await fake.storage.collection('plays').increment('m', 'plays');
    const bob = fake.as({ viewer: { username: 'bob', id: 910_002 } }).storage;
    expect((await bob.collection('posts').get('p'))!.author).toEqual({ kind: 'user', isViewer: false, username: 'alice' });
    expect((await bob.collection('plays').get('m'))!.author).toEqual({ kind: 'counter' });
    expect((await fake.storage.collection('prefs').put('k', {})).author).toEqual({ kind: 'user', isViewer: true });
    expect(JSON.stringify(fake.calls.map((c) => c.response))).not.toMatch(/91000[12]/);
  });

  it('deleting a shared document drops its counters and marks', async () => {
    const { fake } = make();
    const posts = fake.storage.collection('posts');
    await posts.put('p', {});
    await posts.increment('p', 'views', 5);
    await posts.mark('p', 'vote');
    await posts.delete('p');
    const again = await posts.put('p', {});
    expect(again).toMatchObject({ version: 1, counters: { views: 0 }, marks: { vote: 0 }, viewer: { marks: [] } });
  });

  it('a counter and a version are separate: increments never bump the version', async () => {
    const { fake } = make();
    const posts = fake.storage.collection('posts');
    await posts.put('p', {});
    await posts.increment('p', 'views');
    await posts.mark('p', 'vote');
    expect((await posts.get('p'))!.version).toBe(1);
    expect((await posts.put('p', { x: 1 }, { ifVersion: 1 })).version).toBe(2);
  });

  it('byte quotas, in the stored unit: the viewer ceiling for private, the author ceiling for shared', async () => {
    const { fake } = make({ limits: { viewerBytes: 40 } });
    // `{"a": "xxxxxxxxxx"}` stores as 19 bytes (the database's text adds a space).
    await fake.storage.collection('prefs').put('k1', { a: 'xxxxxxxxxx' });
    await fake.storage.collection('prefs').put('k2', { a: 'xxxxxxxxxx' });
    const e = await refusal(fake.storage.collection('prefs').put('k3', { a: 'xx' }));
    expect(e.code).toBe('quota_exceeded');
    expect(e.details).toEqual({ ceiling: 'viewer' });
    await fake.storage.collection('prefs').delete('k2');
    const shared = await refusal(fake.storage.collection('posts').put('p', { a: 'x'.repeat(30) }));
    expect(shared.details).toEqual({ ceiling: 'author' });
    // A failed write changes nothing.
    expect((await fake.storage.collection('prefs').list()).items.map((d) => d.key)).toEqual(['k1']);
  });

  it('getMany: at most 100 keys; info reports usage and the declarations', async () => {
    const { fake } = make();
    const keys = Array.from({ length: 101 }, (_, i) => `k${i}`);
    expect((await refusal(fake.storage.collection('prefs').getMany(keys))).code).toBe('invalid_request');
    await fake.storage.collection('prefs').put('k', { a: 1 });
    const info = await fake.storage.info();
    expect(info.usage).toEqual({ app: { bytes: 8, docs: 1 }, viewer: { bytes: 8, docs: 1 } });
    expect(info.collections.posts).toMatchObject({ write: 'own', indexes: { rank: 'number' }, showAuthor: true });
    expect(info.collections.prefs).not.toHaveProperty('write');
  });

  it('an index value of the wrong type refuses the write', async () => {
    const { fake } = make();
    expect((await refusal(fake.storage.collection('posts').put('p', { rank: 'high' }))).details).toEqual({ index: 'rank' });
  });

  it('a custom scanner replaces the default words', async () => {
    const { fake } = make({ moderate: (text) => (text.includes('nope') ? 'blocked' : null) });
    expect((await refusal(fake.storage.collection('posts').put('p', { t: 'nope' }))).details).toEqual({ category: 'blocked' });
    await expect(fake.storage.collection('posts').put('q', { t: 'contract-blocked-term' })).resolves.toBeTruthy();
  });
});

describe('the call log', () => {
  it('records what the client sent and what the fake answered', async () => {
    const { fake } = make();
    await fake.storage.collection('prefs').put('k', { a: 1 }, { ifVersion: 0 });
    await fake.storage.collection('prefs').delete('k', { ifVersion: 9 }).catch(() => undefined);
    expect(fake.calls.map((c) => [c.method, c.path, c.query, c.status])).toEqual([
      ['PUT', 'blocks/storage/prefs/k', {}, 200],
      ['DELETE', 'blocks/storage/prefs/k', { ifVersion: '9' }, 409],
    ]);
    expect(fake.calls[0]!.body).toEqual({ data: { a: 1 }, ifVersion: 0 });
  });
});
