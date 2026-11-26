import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import type { ApiError } from '../../src/http/index.js';
import type { DocumentListQuery, StorageCollection, StorageCollectionInfo, StorageDocument, StorageLimits } from '../../src/index.js';
// @ts-expect-error removed in 0.33: counters went with the tally PATCH route
import type { StorageIncrementOp } from '../../src/index.js';
// @ts-expect-error removed in 0.33: marks went with the tally PATCH route
import type { StorageMarkOp } from '../../src/index.js';
// @ts-expect-error removed in 0.33: marks went with the tally PATCH route
import type { StorageUnmarkOp } from '../../src/index.js';
// @ts-expect-error removed in 0.33: `collection().update` is gone
import type { StorageUpdateOp } from '../../src/index.js';
// @ts-expect-error removed in 0.33: server-side publish is gone
import type { StoragePublishRequest } from '../../src/index.js';
// @ts-expect-error removed in 0.33: server-side publish is gone
import type { StoragePublishSkipReason } from '../../src/index.js';
// @ts-expect-error removed in 0.33: server-side publish is gone
import type { StoragePublishResult } from '../../src/index.js';
// @ts-expect-error removed in 0.33: server-side unpublish is gone
import type { StorageUnpublishResult } from '../../src/index.js';
// @ts-expect-error removed in 0.33: the legacy key/value store is gone
import type { StorageClient } from '../../src/index.js';
// @ts-expect-error removed in 0.33: the legacy key/value store is gone
import type { StorageQuota } from '../../src/index.js';
// @ts-expect-error removed in 0.33: the legacy key/value store is gone
import type { StorageKeyEntry } from '../../src/index.js';
// @ts-expect-error removed in 0.33: `app.sharedStorage` is gone
import type { SharedStorageClient } from '../../src/index.js';
// @ts-expect-error removed in 0.33: `app.sharedStorage` is gone
import type { SharedItem } from '../../src/index.js';
import { createFakeStorage, createFakeTransport } from '../../src/testing.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

/**
 * 0.33 REMOVED what civitai.com stopped serving (civitai/civitai#10391, live 2026-11-25; the
 * legacy stores 2026-11-10): `collection().update`, `increment`, `unmark`, `publish`,
 * `unpublish`, the tally fields and list options, the legacy key/value methods on `app.storage`
 * and `app.sharedStorage`. `mark` stays for the one name the server still serves, `report`.
 *
 * Two halves: the `@ts-expect-error` lines above and in `type-level` are checked by
 * `tsc -p tsconfig.test.json` (the package's `typecheck`, in CI), where each one fails as an
 * UNUSED directive while the name still exists; the rest runs here.
 */

/** The methods 0.33 removed from a collection: none may be present on any store's collection. */
const REMOVED_COLLECTION_METHODS = ['update', 'increment', 'unmark', 'publish', 'unpublish'];
/** The legacy key/value methods 0.33 removed from `app.storage`. */
const REMOVED_STORAGE_METHODS = ['get', 'set', 'delete', 'list', 'getQuota'];

const MANIFEST = {
  scopes: ['apps:storage', 'apps:storage:publish'],
  storage: {
    collections: {
      // Still declarable in an approved manifest; nothing serves them.
      posts: { visibility: 'shared', write: 'own', marks: ['vote'], counters: ['views'] },
      plays: { visibility: 'shared', write: 'none', counters: ['plays'] },
    },
  },
};

describe('removed names are not exported', () => {
  it('app.sharedStorage and the legacy key/value methods are absent at run time', async () => {
    const { fetch } = fakeFetch([]);
    const app = await initialize({ token: 'tok', fetch });
    expect('sharedStorage' in app).toBe(false);
    for (const name of REMOVED_STORAGE_METHODS) expect(name in app.storage, name).toBe(false);
    // Control: what stays is there.
    expect([typeof app.storage.collection, typeof app.storage.info, typeof app.moderation.report]).toEqual([
      'function',
      'function',
      'function',
    ]);
  });

  it('no collection carries a removed method: the site client, service mode, the fake, the local preview', async () => {
    const site = (await initialize({ token: 'tok', fetch: fakeFetch([]).fetch })).storage.collection('posts');
    const service = (
      await initialize({
        transport: createFakeTransport({
          token: { raw: 'jwt', kind: 'block', scopes: [], expiresAt: new Date(0) },
          viewer: { id: 7, username: 'koen' },
          appData: { url: 'https://app-data.example', slug: 'this-app' },
        }),
        fetch: fakeFetch([]).fetch,
      })
    ).storage.collection('posts');
    const fake = createFakeStorage({ manifest: MANIFEST }).storage.collection('posts');
    const preview = (
      await initialize({ transport: createFakeTransport({ storageMode: 'local-preview' }), fetch: fakeFetch([]).fetch })
    ).storage.collection('posts');
    for (const [where, collection] of Object.entries({ site, service, fake, preview })) {
      for (const name of REMOVED_COLLECTION_METHODS) expect(name in collection, `${where}.${name}`).toBe(false);
      // Control: the viewer-keyed API and the report route stay.
      for (const name of ['getMine', 'putMine', 'deleteMine', 'mark']) expect(typeof (collection as unknown as Record<string, unknown>)[name], `${where}.${name}`).toBe('function');
    }
  });

  it('the legacy store modules are gone from the source', () => {
    for (const dir of ['storage', 'shared-storage']) {
      expect(existsSync(fileURLToPath(new URL(`../../src/${dir}/index.ts`, import.meta.url))), dir).toBe(false);
    }
  });

  it('type-level: the removed members do not compile', () => {
    const typeOnly = (collection: StorageCollection, doc: StorageDocument, info: StorageCollectionInfo, limits: StorageLimits) => {
      // @ts-expect-error removed in 0.33
      void collection.update;
      // @ts-expect-error removed in 0.33
      void collection.increment;
      // @ts-expect-error removed in 0.33
      void collection.unmark;
      // @ts-expect-error removed in 0.33
      void collection.publish;
      // @ts-expect-error removed in 0.33
      void collection.unpublish;
      // @ts-expect-error removed in 0.33: only `report` is a mark now
      void collection.mark('k', 'vote');
      // @ts-expect-error removed in 0.33
      void doc.counters;
      // @ts-expect-error removed in 0.33
      void doc.marks;
      // @ts-expect-error removed in 0.33
      void doc.viewer;
      // @ts-expect-error removed in 0.33
      void info.counters;
      // @ts-expect-error removed in 0.33
      void info.marks;
      // @ts-expect-error removed in 0.33
      void limits.rate.marksAndCountersPerMinute;
      // @ts-expect-error removed in 0.33
      const marked: DocumentListQuery = { markedBy: 'me' };
      // @ts-expect-error removed in 0.33
      const mark: DocumentListQuery = { mark: 'vote' };
      return [marked, mark];
    };
    const app = null as unknown as Awaited<ReturnType<typeof initialize>>;
    const appOnly = () => {
      // @ts-expect-error removed in 0.33
      void app.sharedStorage;
      // @ts-expect-error removed in 0.33
      void app.storage.getQuota;
    };
    // The names imported above, referenced so that while one still exists its import is not
    // also an unused-import error, which would satisfy the directive and hide it.
    type Removed = [
      StorageIncrementOp,
      StorageMarkOp,
      StorageUnmarkOp,
      StorageUpdateOp,
      StoragePublishRequest,
      StoragePublishSkipReason,
      StoragePublishResult,
      StorageUnpublishResult,
      StorageClient,
      StorageQuota,
      StorageKeyEntry,
      SharedStorageClient,
      SharedItem,
    ];
    const removed: Removed | undefined = undefined;
    expect([typeof typeOnly, typeof appOnly, removed]).toEqual(['function', 'function', undefined]);
  });
});

describe('reading today\'s server: the leftover tally fields are ignored', () => {
  const at = '2026-11-25T12:00:00.000Z';
  const doc = { key: 'p1', data: { t: 1 }, version: 2, createdAt: at, updatedAt: at, author: { kind: 'user', isViewer: true } };

  it.each([
    ['as civitai.com sends them today (empty)', { counters: {}, marks: {}, viewer: { marks: [] } }],
    ['as an anonymous reader gets them', { counters: {}, marks: {}, viewer: null }],
    ['not at all (a later server)', {}],
    ['malformed (they are not read)', { counters: 'x', marks: [1], viewer: 7 }],
  ])('a document %s parses, without them', async (_how, leftovers) => {
    const { fetch } = fakeFetch([() => json(200, { ...doc, ...leftovers })]);
    const got = await (await initialize({ token: 'tok', fetch })).storage.collection('posts').get('p1');
    expect(Object.keys(got!).sort()).toEqual(['author', 'createdAt', 'data', 'key', 'updatedAt', 'version']);
    expect(got).toMatchObject({ key: 'p1', version: 2, data: { t: 1 } });
  });

  it("info's leftover `counters: []`, `marks: []` and `marksAndCountersPerMinute: 0` do not break it", async () => {
    const body = {
      collections: { posts: { kind: 'docs', visibility: 'shared', write: 'own', counters: [], marks: [], indexes: {}, showAuthor: false } },
      limits: { rate: { readsPerMinute: 300, marksAndCountersPerMinute: 0 } },
      usage: { app: { bytes: 0, docs: 0 }, viewer: { bytes: 0, docs: 0 } },
    };
    const { fetch } = fakeFetch([() => json(200, body)]);
    await expect((await initialize({ token: 'tok', fetch })).storage.info()).resolves.toMatchObject({ collections: { posts: { write: 'own' } } });
  });
});

describe('the fake answers the removed routes as civitai.com does', () => {
  const raw = async (method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}) => {
    const fake = createFakeStorage({ manifest: MANIFEST });
    await fake.storage.collection('posts').put('p1', { t: 1 });
    const e = (await fake.http(method, `blocks/storage/${path}`, opts).then(
      () => expect.fail(`${method} ${path} resolved`),
      (error: unknown) => error,
    )) as ApiError;
    return [e.status, (e.body as { code?: unknown }).code];
  };

  it.each([
    ['PATCH', 'posts/p1', { body: { $inc: { views: 1 } } }, 405, 'method_not_allowed'],
    ['POST', 'posts/p1/counters/views', {}, 404, 'not_found'],
    ['PUT', 'posts/p1/marks/vote', {}, 404, 'not_found'],
    ['DELETE', 'posts/p1/marks/vote', {}, 404, 'not_found'],
    ['POST', '_publish/posts', { body: { from: 'posts', keys: ['p1'] } }, 404, 'not_found'],
    ['POST', '_unpublish/posts', { body: { keys: ['p1'] } }, 404, 'not_found'],
    ['GET', 'posts', { query: { markedBy: 'me', mark: 'vote' } }, 400, 'invalid_request'],
    ['GET', 'posts', { query: { sort: 'counter:views' } }, 400, 'index_not_declared'],
    ['GET', 'posts', { query: { sort: '-mark:vote' } }, 400, 'index_not_declared'],
    ['DELETE', 'posts/p1/marks/report', {}, 400, 'invalid_request'],
  ] as const)('%s /%s %j → %i %s', async (method, path, opts, status, code) => {
    expect(await raw(method, path, opts)).toEqual([status, code]);
  });

  it("mark('report') files a report; a write: none collection is read-only; documents and info carry the empty compatibility fields", async () => {
    const fake = createFakeStorage({ manifest: MANIFEST });
    const posts = fake.storage.collection('posts');
    await posts.put('p1', { t: 1 });
    await expect(posts.mark('p1', 'report')).resolves.toEqual({ marked: true });
    await expect(fake.storage.collection('plays').put('m', {})).rejects.toMatchObject({ status: 403, code: 'write_policy' });
    await posts.get('p1');
    expect(fake.calls.at(-1)!.response).toMatchObject({ counters: {}, marks: {}, viewer: { marks: [] } });
    await fake.storage.info();
    expect(fake.calls.at(-1)!.response).toMatchObject({
      collections: { posts: { counters: [], marks: [] }, plays: { counters: [], marks: [] } },
      limits: { rate: { marksAndCountersPerMinute: 0 } },
    });
  });
});
