import { describe, expect, it } from 'vitest';

import { StorageError } from '../../src/doc-store/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';

/**
 * The fake's own behaviour beyond the contract run.
 *
 * 🔴 NOT CONTRACT-PINNED; CAN DRIFT FROM THE SERVER. These expectations were ported
 * from the server source on civitai `main` (`doc-store-api.ts`, `doc-store.ts`,
 * `shared-storage-rate-limit.ts`), not from the contract, so nothing re-checks them
 * against the server when it changes. They are meant to move into upstream contract
 * cases in a later civitai PR, and leave this file then:
 *   - the shared write budget: burst 10 refilling every 6 min, the rejection bucket
 *     (30 min), refunds on a refused write and none charged for an outage, per viewer;
 *   - fixed-window resets and `retryAfter` values; anonymous reads sharing one window;
 *   - typed `where` filters (number, boolean, time) and the one-filter limit;
 *   - sorts by an index, a tally (absent = 0, key tiebreak in the sort direction),
 *     `createdAt`; `keyPrefix`; `markedBy` + `mark`;
 *   - authorship display (`username` only under `showAuthor`; `counter` authors);
 *   - deleting a shared document drops its counters and marks; tallies never bump
 *     `version`;
 *   - byte quotas in the stored unit and their `ceiling`; `info()` usage figures;
 *     `getMany`'s 100-key limit; an index value of the wrong type refusing a write.
 *
 * What is the FAKE's by design, not the server's: phased features refused at
 * construction, rate limits off by default, and an opaque cursor bound to its query.
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
    // On here: the budget and window tests below need it. See 'rate limits are opt-in'.
    enforceRateLimits: true,
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
  it.each([
    ['write "owner"', { visibility: 'shared', write: 'owner' }, /write "owner"/],
    ['write "anyone"', { visibility: 'shared', write: 'anyone' }, /write "anyone"/],
    ['kind "log"', { visibility: 'private', kind: 'log' }, /kind "log"/],
    ['maxEntries', { visibility: 'private', maxEntries: 10 }, /log collections/],
    ['ttlSeconds', { visibility: 'private', ttlSeconds: 3600 }, /ttlSeconds/],
    ['dailyWritesPerAuthor', { visibility: 'shared', write: 'own', dailyWritesPerAuthor: 5 }, /dailyWritesPerAuthor/],
  ])('a phased feature (%s) is refused when the fake is created, naming it', (_what, decl, message) => {
    expect(() => make({}, { later: decl, prefs: { visibility: 'private' } })).toThrow(message);
    expect(() => make({}, { later: decl })).toThrow(/storage\.collections\.later: .* is not available yet/);
  });

  it('a declaration it cannot read is refused when the fake is created', () => {
    expect(() => make({}, { p: { write: 'own' } })).toThrow(/needs visibility/);
    expect(() => make({}, { p: { visibility: 'shared' } })).toThrow(/needs write "own" or "none"/);
    expect(() => make({}, { p: { visibility: 'private', indexes: { at: 'date' } } })).toThrow(/type must be one of/);
  });

  it('a manifest without storage declares nothing', async () => {
    const fake = createFakeStorage({ manifest: { scopes: ['apps:storage'] } });
    expect((await refusal(fake.storage.collection('prefs').list())).code).toBe('collection_not_declared');
  });
});

describe('rate limits are opt-in', () => {
  it('off by default: no window and no shared write budget throttles an app\'s tests', async () => {
    const { fake } = make({ enforceRateLimits: false });
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 15; i++) await posts.put(`p${i}`, {});
    for (let i = 0; i < 40; i++) await fake.storage.collection('plays').increment('m', 'plays');
    for (let i = 0; i < 25; i++) await posts.mark('p0', 'report');
    await expect(posts.list({ limit: 100 })).resolves.toMatchObject({ items: { length: 15 } });
  });

  it('the default is off', async () => {
    const fake = createFakeStorage({ manifest: { scopes: SCOPES, storage: { collections: COLLECTIONS } } });
    for (let i = 0; i < 35; i++) await fake.storage.collection('plays').increment('m', 'plays');
    expect((await fake.storage.collection('plays').get('m'))!.counters.plays).toBe(35);
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

  it('a string index sorts by code point, as the server\'s COLLATE "C" does — not by UTF-16 unit', async () => {
    const { fake } = make();
    const posts = fake.storage.collection('posts');
    // U+1F600 is a surrogate pair (0xD83D…), which UTF-16 `<` puts BEFORE U+FF01.
    await posts.put('emoji', { status: '\u{1F600}' });
    await posts.put('fullwidth', { status: '\uFF01' });
    await posts.put('ascii', { status: 'z' });
    expect('\u{1F600}' < '\uFF01').toBe(true); // the trap, as JavaScript sees it
    expect(await keys(posts.list({ sort: 'status' }))).toEqual(['ascii', 'fullwidth', 'emoji']);
    expect(await keys(posts.list({ sort: '-status' }))).toEqual(['emoji', 'fullwidth', 'ascii']);
    // …and paging follows the same order.
    const first = await posts.list({ sort: 'status', limit: 2 });
    expect(await keys(posts.list({ sort: 'status', limit: 2, cursor: first.nextCursor! }))).toEqual(['emoji']);
  });

  it('a cursor is opaque and bound to its whole query', async () => {
    const { posts } = await seeded();
    const first = await posts.list({ sort: 'rank', limit: 1 });
    expect(first.items.map((d) => d.key)).toEqual(['b:1']);
    const cursor = first.nextCursor!;
    // Opaque: neither the last key nor its sort value is readable from it.
    expect(cursor).not.toContain('b:1');
    expect(cursor).not.toContain('-1');
    // Deterministic: the same calls on a fresh fake issue the same token.
    const { posts: again } = await seeded();
    expect((await again.list({ sort: 'rank', limit: 1 })).nextCursor).toBe(cursor);
    // The same query continues…
    expect(await keys(posts.list({ sort: 'rank', limit: 1, cursor }))).toEqual(['a:1']);
    // …any other sort, filter or collection is refused.
    expect((await refusal(posts.list({ sort: 'key', cursor }))).code).toBe('invalid_request');
    expect((await refusal(posts.list({ sort: 'rank', where: { status: 'open' }, cursor }))).code).toBe('invalid_request');
    expect((await refusal(posts.list({ sort: 'rank', author: 'me', cursor }))).code).toBe('invalid_request');
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
