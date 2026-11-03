import { afterEach, describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { createDocumentStorage, StorageError, storageImportRefusal } from '../../src/doc-store/index.js';
import { LOCAL_PREVIEW_MANIFEST_GLOBAL } from '../../src/doc-store/local-preview.js';
import { ApiError, type Http, type RequestOptions } from '../../src/http/index.js';
import { createFakeStorage, createFakeTransport, type FakeStorageOptions } from '../../src/testing.js';

/**
 * Cross-app storage imports (civitai/civitai#7494): `app.storage.collection(name, { from })`.
 *
 * The wire contract is the PR's (`?from=<source blockId>` on every collection route, the
 * same method, path, body and reply; `info` takes none) and so is the refusal order the
 * fake ports from `resolveImportAccess`. Not contract-pinned: the vendored storage
 * contract has no import cases yet, so these are ported from the server source at
 * civitai/civitai#7494's head and can drift from it.
 *
 * Fixtures: the parent and the fork declare a collection of the SAME name (`notes`), with
 * different documents in each, so a call that reached the wrong app reads the wrong text
 * rather than passing by coincidence. Blockids, collection names and texts are pairwise
 * distinct.
 */

const PARENT = 'parent-app';
const FORK = 'fork-app';

const PARENT_MANIFEST = {
  scopes: ['apps:storage', 'apps:storage:publish'],
  storage: {
    collections: {
      notes: { visibility: 'private' },
      board: { visibility: 'shared', write: 'own', marks: ['vote'], counters: ['views'] },
      tally: { visibility: 'shared', write: 'none', counters: ['plays'] },
      secret: { visibility: 'private', exportable: false },
    },
  },
};

const FORK_MANIFEST = {
  scopes: ['apps:storage', 'apps:storage:import'],
  storage: {
    collections: { notes: { visibility: 'private' } },
    imports: [{ from: PARENT, collections: ['notes', 'board', 'tally', 'secret'], access: 'readwrite' }],
  },
};

function forkAndParent(extra: Partial<FakeStorageOptions> = {}) {
  return createFakeStorage({
    manifest: FORK_MANIFEST,
    blockId: FORK,
    viewer: { username: 'alice' },
    sources: { [PARENT]: { manifest: PARENT_MANIFEST } },
    ...extra,
  });
}

const refusal = async (p: Promise<unknown>): Promise<StorageError> => {
  const outcome = await p.then(
    () => new Error('expected a refusal'),
    (e: unknown) => e,
  );
  expect(outcome).toBeInstanceOf(StorageError);
  return outcome as StorageError;
};

/** An `Http` that records what the client sent and answers from a script. */
function recorder(answer: (method: string, path: string, opts: RequestOptions) => unknown = () => ({})) {
  const sent: { method: string; path: string; opts: RequestOptions }[] = [];
  const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
    sent.push({ method, path, opts });
    return answer(method, path, opts);
  }) as Http;
  return { sent, storage: createDocumentStorage(http) };
}

const WIRE_DOC = {
  key: 'n1',
  data: { text: 'wire' },
  version: 2,
  createdAt: '2026-11-02T01:02:03.004Z',
  updatedAt: '2026-11-02T05:06:07.008Z',
  author: { kind: 'user', isViewer: true },
  counters: {},
  marks: {},
  viewer: { marks: [] },
};

describe('the client: `from` on every collection call', () => {
  const answer = (method: string, path: string) => {
    if (path.includes('/counters/')) return { value: 3 };
    if (path.includes('/marks/')) return { marked: method === 'PUT', count: 1 };
    if (path.startsWith('blocks/storage/_get/')) return { items: [WIRE_DOC] };
    if (method === 'DELETE') return { deleted: true };
    if (method === 'GET' && path === 'blocks/storage/notes') return { items: [], nextCursor: null };
    return WIRE_DOC;
  };
  const queryOf = (opts: RequestOptions) =>
    Object.fromEntries(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined));

  it('sends ?from=<blockId> on get, getMany, put, create, delete, list, increment, mark and unmark — path, verb and body unchanged', async () => {
    const r = recorder(answer);
    const notes = r.storage.collection('notes', { from: PARENT });
    await notes.get('n1');
    await notes.getMany(['n1']);
    await notes.put('n1', { text: 'p' }, { ifVersion: 2 });
    await notes.create({ text: 'c' });
    await notes.delete('n1', { ifVersion: 3 });
    await notes.list({ sort: '-updatedAt', limit: 5 });
    await notes.increment('n1', 'views', 2);
    await notes.mark('n1', 'vote');
    await notes.unmark('n1', 'vote');

    expect(r.sent.map((s) => [s.method, s.path, queryOf(s.opts), s.opts.body])).toEqual([
      ['GET', 'blocks/storage/notes/n1', { from: PARENT }, undefined],
      ['POST', 'blocks/storage/_get/notes', { from: PARENT }, { keys: ['n1'] }],
      ['PUT', 'blocks/storage/notes/n1', { from: PARENT }, { data: { text: 'p' }, ifVersion: 2 }],
      ['POST', 'blocks/storage/notes', { from: PARENT }, { data: { text: 'c' } }],
      ['DELETE', 'blocks/storage/notes/n1', { ifVersion: 3, from: PARENT }, undefined],
      ['GET', 'blocks/storage/notes', { sort: '-updatedAt', limit: 5, from: PARENT }, undefined],
      ['POST', 'blocks/storage/notes/n1/counters/views', { from: PARENT }, { by: 2 }],
      ['PUT', 'blocks/storage/notes/n1/marks/vote', { from: PARENT }, undefined],
      ['DELETE', 'blocks/storage/notes/n1/marks/vote', { from: PARENT }, undefined],
    ]);
  });

  it('without options, and with options naming no `from`, sends no `from` at all', async () => {
    const r = recorder(answer);
    await r.storage.collection('notes').get('n1');
    await r.storage.collection('notes', {}).delete('n1');
    expect(r.sent.map((s) => 'from' in (s.opts.query ?? {}))).toEqual([false, false]);
  });

  it.each([
    ['{ from: undefined }', { from: undefined }],
    ['{ from: null }', { from: null }],
    ['a bare blockId', PARENT],
  ])('refuses %s before sending — it would otherwise reach THIS app\'s own collection', async (_what, options) => {
    const r = recorder(answer);
    const coll = r.storage.collection('notes', options as never);
    const error = await refusal(coll.put('n1', { text: 'meant for the parent' }));
    expect(error.code).toBe('invalid_request');
    expect(error.status).toBe(400);
    await expect(coll.list()).rejects.toMatchObject({ code: 'invalid_request' });
    expect(r.sent).toEqual([]);
  });

  it('info refuses `from` before sending: a source app\'s info and usage cannot be read', async () => {
    const r = recorder(answer);
    const error = await refusal(r.storage.info({ from: PARENT } as never));
    expect(error.code).toBe('invalid_request');
    expect(error.details).toEqual({ from: PARENT });
    expect(error.message).toMatch(/info takes no `from`/);
    expect(r.sent).toEqual([]);
  });

  it('through initialize(): the URL carries from=<blockId> on the collection route', async () => {
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(WIRE_DOC), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 'tok', fetch });
    await app.storage.collection('notes', { from: PARENT }).get('n1');
    expect(urls).toEqual([`https://civitai.com/api/v1/blocks/storage/notes/n1?from=${PARENT}`]);
  });
});

describe('storageImportRefusal: each import refusal, typed', () => {
  const err = (status: number, code: string, details?: Record<string, unknown>) =>
    new StorageError(status, code, code, { code, message: code, error: code, details }, details);

  it.each([
    [err(403, 'consent_required', { scope: 'apps:storage:import', from: PARENT }), { kind: 'import_consent', scope: 'apps:storage:import', from: PARENT }],
    [err(403, 'consent_required', { scope: 'apps:storage:publish', from: PARENT }), { kind: 'source_publish_consent', scope: 'apps:storage:publish', from: PARENT }],
    [err(403, 'write_policy', { from: PARENT, reason: 'import_read_only' }), { kind: 'read_only', from: PARENT }],
    [err(403, 'import_not_declared', { from: PARENT, collection: 'notes' }), { kind: 'not_declared', from: PARENT, collection: 'notes' }],
    [err(403, 'import_not_declared', { from: FORK }), { kind: 'not_declared', from: FORK }],
    [err(403, 'not_exportable', { collection: 'secret', from: PARENT }), { kind: 'not_exportable', from: PARENT, collection: 'secret' }],
    [err(404, 'collection_not_declared', { collection: 'gone', from: PARENT }), { kind: 'source_collection_not_declared', from: PARENT, collection: 'gone' }],
    [err(403, 'not_eligible', { reason: 'import_dev_token' }), { kind: 'not_eligible', reason: 'import_dev_token' }],
    [err(403, 'not_eligible', { reason: 'import_hub_token' }), { kind: 'not_eligible', reason: 'import_hub_token' }],
    [err(403, 'not_eligible', { reason: 'import_in_review' }), { kind: 'not_eligible', reason: 'import_in_review' }],
    [err(403, 'not_eligible', { reason: 'source_not_approved' }), { kind: 'not_eligible', reason: 'source_not_approved' }],
  ])('%#: %o', (error, expected) => {
    expect(storageImportRefusal(error)).toEqual(expected);
  });

  it.each([
    ['this app\'s own publish consent (no `from`)', err(403, 'consent_required', { scope: 'apps:storage:publish' })],
    ['this app\'s own write policy', err(403, 'write_policy')],
    ['this app\'s own undeclared collection', err(404, 'collection_not_declared', { collection: 'x' })],
    ['an untrusted account', err(403, 'not_eligible', { reason: 'account_too_new' })],
    ['an unapproved app', err(403, 'not_eligible', { reason: 'app_not_approved' })],
    ['a non-storage error', new ApiError(403, 'Forbidden', '<html>')],
    ['not an error at all', 'consent_required'],
  ])('null for %s', (_what, error) => {
    expect(storageImportRefusal(error)).toBeNull();
  });
});

describe('the fake: a fork reads and writes its parent\'s data', () => {
  it('reads the viewer\'s own documents IN THE PARENT, not the fork\'s same-named collection', async () => {
    const fake = forkAndParent();
    await fake.as({ app: PARENT }).storage.collection('notes').put('n1', { text: 'written in the parent' });
    await fake.storage.collection('notes').put('n1', { text: 'written in the fork' });

    const viaImport = await fake.storage.collection('notes', { from: PARENT }).get('n1');
    expect(viaImport?.data).toEqual({ text: 'written in the parent' });
    expect((await fake.storage.collection('notes').get('n1'))?.data).toEqual({ text: 'written in the fork' });
    expect(fake.calls.at(-2)!.query).toEqual({ from: PARENT });
  });

  it('a private source collection is per viewer there: another viewer reads nothing of alice\'s', async () => {
    const fake = forkAndParent();
    await fake.as({ app: PARENT }).storage.collection('notes').put('n1', { text: 'alice only' });
    const bob = fake.as({ viewer: { username: 'bob' } }).storage;
    expect(await bob.collection('notes', { from: PARENT }).get('n1')).toBeNull();
  });

  it('a write through a readwrite import lands in the PARENT, counted against the parent\'s usage', async () => {
    const fake = forkAndParent();
    await fake.storage.collection('notes', { from: PARENT }).put('n2', { text: 'from the fork' });
    const parent = fake.as({ app: PARENT }).storage;
    expect((await parent.collection('notes').get('n2'))?.data).toEqual({ text: 'from the fork' });
    expect((await parent.info()).usage.viewer.docs).toBe(1);
    expect((await fake.storage.info()).usage.viewer.docs).toBe(0);
    expect(await fake.storage.collection('notes').get('n2')).toBeNull();
  });

  it('a shared source collection reads as the parent shows it; marks and counters land there with publish consent in the parent', async () => {
    const fake = forkAndParent();
    await fake.as({ app: PARENT, viewer: { username: 'carol' } }).storage.collection('board').put('b1', { title: 'hi' });
    const board = fake.storage.collection('board', { from: PARENT });
    expect(await board.mark('b1', 'vote')).toEqual({ marked: true, count: 1 });
    expect(await board.increment('b1', 'views')).toEqual({ value: 1 });
    const seen = await fake.as({ app: PARENT, viewer: { username: 'carol' } }).storage.collection('board').get('b1');
    expect(seen).toMatchObject({ marks: { vote: 1 }, counters: { views: 1 } });
    expect((await board.create({ title: 'by alice via the fork' })).author).toEqual({ kind: 'user', isViewer: true });
  });

  it('list pages through the source with a cursor the fork\'s own collection refuses', async () => {
    const fake = forkAndParent();
    const parentNotes = fake.as({ app: PARENT }).storage.collection('notes');
    for (const k of ['a', 'b', 'c']) await parentNotes.put(k, { text: k });
    await fake.storage.collection('notes').put('z', { text: 'fork' });
    const imported = fake.storage.collection('notes', { from: PARENT });
    const first = await imported.list({ limit: 2 });
    expect(first.items.map((d) => d.key)).toEqual(['a', 'b']);
    expect((await imported.list({ limit: 2, cursor: first.nextCursor! })).items.map((d) => d.key)).toEqual(['c']);
    expect((await refusal(fake.storage.collection('notes').list({ limit: 2, cursor: first.nextCursor! }))).code).toBe(
      'invalid_request',
    );
  });
});

describe('the fake: import refusals, in the server\'s order', () => {
  it('a read import refuses every write, counter and mark `write_policy` (`import_read_only`), and still reads', async () => {
    const fake = forkAndParent({
      manifest: {
        ...FORK_MANIFEST,
        storage: { imports: [{ from: PARENT, collections: ['notes', 'board'], access: 'read' }] },
      },
    });
    const notes = fake.storage.collection('notes', { from: PARENT });
    const board = fake.storage.collection('board', { from: PARENT });
    for (const p of [notes.put('k', {}), notes.create({}), notes.delete('k'), board.increment('k', 'views'), board.mark('k', 'vote'), board.unmark('k', 'vote')]) {
      const error = await refusal(p);
      expect([error.status, error.code, error.details]).toEqual([403, 'write_policy', { from: PARENT, reason: 'import_read_only' }]);
    }
    expect(await notes.get('k')).toBeNull();
  });

  it('an undeclared import, or a collection the import does not name: `import_not_declared` with { from, collection }', async () => {
    const fake = forkAndParent({
      manifest: { ...FORK_MANIFEST, storage: { imports: [{ from: PARENT, collections: ['board'], access: 'read' }] } },
      sources: { [PARENT]: { manifest: PARENT_MANIFEST }, 'other-app': { manifest: PARENT_MANIFEST } },
    });
    for (const [coll, from] of [['notes', PARENT], ['board', 'other-app']] as const) {
      const error = await refusal(fake.storage.collection(coll, { from }).get('k'));
      expect([error.status, error.code, error.details]).toEqual([403, 'import_not_declared', { from, collection: coll }]);
    }
  });

  it('`exportable: false` refuses the import `not_exportable` (403) with { collection, from }', async () => {
    const error = await refusal(forkAndParent().storage.collection('secret', { from: PARENT }).list());
    expect([error.status, error.code, error.details]).toEqual([403, 'not_exportable', { collection: 'secret', from: PARENT }]);
  });

  it('an unapproved or absent source: `not_eligible` (`source_not_approved`)', async () => {
    const pending = forkAndParent({ sources: { [PARENT]: { manifest: PARENT_MANIFEST, status: 'pending' } } });
    const absent = forkAndParent({ sources: {} });
    for (const fake of [pending, absent]) {
      const error = await refusal(fake.storage.collection('notes', { from: PARENT }).get('k'));
      expect([error.status, error.code, error.details]).toEqual([403, 'not_eligible', { reason: 'source_not_approved' }]);
    }
  });

  it('a collection the import names but the source does not declare: 404 `collection_not_declared` with { collection, from }', async () => {
    const fake = forkAndParent({
      manifest: { ...FORK_MANIFEST, storage: { imports: [{ from: PARENT, collections: ['gone'], access: 'read' }] } },
    });
    const error = await refusal(fake.storage.collection('gone', { from: PARENT }).get('k'));
    expect([error.status, error.code, error.details]).toEqual([404, 'collection_not_declared', { collection: 'gone', from: PARENT }]);
  });

  it('no `apps:storage:import` on the token, or it revoked: `consent_required` with { scope, from }', async () => {
    const noScope = forkAndParent().as({ scopes: ['apps:storage'] }).storage;
    const revoked = forkAndParent({ consent: { revoked: ['apps:storage:import'] } }).storage;
    for (const storage of [noScope, revoked]) {
      const error = await refusal(storage.collection('notes', { from: PARENT }).get('k'));
      expect([error.status, error.code, error.details]).toEqual([403, 'consent_required', { scope: 'apps:storage:import', from: PARENT }]);
    }
  });

  it('an unreadable consent marker: 503 `consent_unavailable`, retryable', async () => {
    const error = await refusal(forkAndParent({ consent: 'unavailable' }).storage.collection('notes', { from: PARENT }).get('k'));
    expect([error.status, error.code, error.retryAfter]).toEqual([503, 'consent_unavailable', 1]);
  });

  it.each([
    ['no grant for the source', {}],
    ['a grant that misses a collection the import now names', { [PARENT]: { collections: ['notes'], access: 'readwrite' as const } }],
    ['a read grant for a readwrite import', { [PARENT]: { collections: ['notes', 'board', 'tally', 'secret'], access: 'read' as const } }],
  ])('a grant that does not cover the CURRENT import (%s): `consent_required`', async (_what, importGrants) => {
    const error = await refusal(forkAndParent({ importGrants }).storage.collection('notes', { from: PARENT }).get('k'));
    expect([error.code, error.details]).toEqual(['consent_required', { scope: 'apps:storage:import', from: PARENT }]);
  });

  it('a grant WIDER than the import covers it (a later version that narrows needs no prompt)', async () => {
    const fake = forkAndParent({
      manifest: { ...FORK_MANIFEST, storage: { imports: [{ from: PARENT, collections: ['notes'], access: 'read' }] } },
      importGrants: { [PARENT]: { collections: ['notes', 'board'], access: 'readwrite' } },
    });
    expect(await fake.storage.collection('notes', { from: PARENT }).get('k')).toBeNull();
  });

  describe('publish consent IN THE SOURCE (an import grant is not it)', () => {
    const withoutPublishInParent = () =>
      forkAndParent({ sources: { [PARENT]: { manifest: PARENT_MANIFEST, consent: { revoked: ['apps:storage:publish'] } } } });
    const PUBLISH_IN_PARENT = { scope: 'apps:storage:publish', from: PARENT };

    it('create and put in a shared `own` source collection: `consent_required` naming the publish scope and the source', async () => {
      const board = withoutPublishInParent().storage.collection('board', { from: PARENT });
      for (const p of [board.create({ t: 1 }), board.put('b1', { t: 2 })]) {
        const error = await refusal(p);
        expect([error.status, error.code, error.details]).toEqual([403, 'consent_required', PUBLISH_IN_PARENT]);
        expect(storageImportRefusal(error)).toEqual({ kind: 'source_publish_consent', ...PUBLISH_IN_PARENT });
      }
    });

    it('a counter in a `write: "none"` source collection, and a mark (report included), need it too', async () => {
      // No document needs to exist: the refusal comes before the store is read.
      const fake = withoutPublishInParent();
      const tally = fake.storage.collection('tally', { from: PARENT });
      const board = fake.storage.collection('board', { from: PARENT });
      for (const p of [tally.increment('m1', 'plays'), board.mark('b1', 'vote'), board.unmark('b1', 'vote'), board.mark('b1', 'report')]) {
        const error = await refusal(p);
        expect([error.code, error.details]).toEqual(['consent_required', PUBLISH_IN_PARENT]);
      }
      // ...the parent's own app still counts with `apps:storage` alone, as before.
      expect(await fake.as({ app: PARENT }).storage.collection('tally').increment('m1', 'plays')).toEqual({ value: 1 });
    });

    it('a private source collection needs only the import grant; a delete in a shared one never needs it', async () => {
      const fake = withoutPublishInParent();
      const put = await fake.storage.collection('notes', { from: PARENT }).put('n1', { text: 'private, no publish needed' });
      expect(put.version).toBe(1);
      // Reaches the store (nothing to delete) rather than the publish refusal a create gets above.
      expect(await fake.storage.collection('board', { from: PARENT }).delete('b9')).toEqual({ deleted: false });
    });

    it('the FORK\'s own apps:storage:publish never counts', async () => {
      const fake = withoutPublishInParent();
      const asForkWithPublish = fake.as({ scopes: ['apps:storage', 'apps:storage:import', 'apps:storage:publish'] }).storage;
      const error = await refusal(asForkWithPublish.collection('board', { from: PARENT }).create({ t: 3 }));
      expect(error.details).toEqual(PUBLISH_IN_PARENT);
    });
  });

  it('a dev token is refused every import: `not_eligible` (`import_dev_token`), before the declaration is read', async () => {
    const dev = forkAndParent().as({ token: 'dev' }).storage;
    for (const coll of ['notes', 'undeclared']) {
      const error = await refusal(dev.collection(coll, { from: PARENT }).get('k'));
      expect([error.status, error.code, error.details]).toEqual([403, 'not_eligible', { reason: 'import_dev_token' }]);
    }
    // The dev token's OWN collection still works: only the import is refused.
    expect(await dev.collection('notes').get('k')).toBeNull();
  });

  it('an anonymous viewer: `sign_in_required` (a grant is per viewer), after the declaration check', async () => {
    const anon = forkAndParent().as({ viewer: null }).storage;
    expect((await refusal(anon.collection('board', { from: PARENT }).list())).code).toBe('sign_in_required');
    expect((await refusal(anon.collection('nope', { from: PARENT }).list())).code).toBe('import_not_declared');
  });

  it('at the wire: `from` twice and a non-blockId `from` are `invalid_request`; info refuses `from` as an unknown parameter', async () => {
    const fake = forkAndParent();
    const raw = (query: Record<string, unknown>, path = 'blocks/storage/notes/k') =>
      fake.http('GET', path, { query: query as never }).catch((e: unknown) => e as ApiError);
    expect(((await raw({ from: [PARENT, PARENT] })) as ApiError).body).toMatchObject({ code: 'invalid_request', message: 'from must be given once' });
    expect(((await raw({ from: 'Not_A_BlockId' })) as ApiError).body).toMatchObject({ code: 'invalid_request', details: { from: 'Not_A_BlockId' } });
    expect(((await raw({ from: PARENT }, 'blocks/storage')) as ApiError).body).toMatchObject({
      code: 'invalid_request',
      message: 'unknown query parameter from',
    });
  });

  it('every import call is charged to the CONSUMER\'s read bucket first, refused ones too', async () => {
    const t = Date.parse('2031-03-04T00:00:00.000Z');
    const fake = forkAndParent({ enforceRateLimits: true, now: () => t });
    for (let i = 0; i < 300; i++) await refusal(fake.storage.collection('secret', { from: PARENT }).get('k'));
    const error = await refusal(fake.storage.collection('secret', { from: PARENT }).get('k'));
    expect([error.code, error.details?.bucket]).toEqual(['rate_limited', 'read']);
    // The parent's own bucket for this viewer was never touched by those refusals.
    expect(await fake.as({ app: PARENT }).storage.collection('notes').get('k')).toBeNull();
  });
});

describe('the fake: imports in the manifest', () => {
  it.each([
    ['an import of this app itself', [{ from: FORK, collections: ['notes'], access: 'read' }], /cannot import from itself/],
    ['the same source twice', [
      { from: PARENT, collections: ['notes'], access: 'read' },
      { from: PARENT, collections: ['board'], access: 'read' },
    ], /imported more than once/],
    ['an access that is not read or readwrite', [{ from: PARENT, collections: ['notes'], access: 'write' }], /access/],
    ['nine imports', Array.from({ length: 9 }, (_, i) => ({ from: `src-${i}`, collections: ['notes'], access: 'read' })), /1 to 8/],
  ])('refuses %s when the fake is created', (_what, imports, message) => {
    expect(() => forkAndParent({ manifest: { scopes: FORK_MANIFEST.scopes, storage: { imports } } })).toThrow(message);
  });

  it('a manifest with imports and no collections of its own is served (a fresh fork)', async () => {
    const fake = forkAndParent({ manifest: { scopes: FORK_MANIFEST.scopes, storage: { imports: FORK_MANIFEST.storage.imports } } });
    expect(await fake.storage.collection('notes', { from: PARENT }).get('k')).toBeNull();
    expect((await refusal(fake.storage.collection('notes').get('k'))).code).toBe('collection_not_declared');
  });
});

describe('a dev-tunnel preview: the local store refuses an import as the server refuses a dev token', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL];
  });

  it('`not_eligible` (`import_dev_token`), 403, nothing sent — and the app\'s own collections still work', async () => {
    (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL] = FORK_MANIFEST;
    const urls: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch;
    const transport = createFakeTransport({
      token: { raw: 'tunnel-token', scopes: ['user:read:self'], expiresAt: new Date(0), kind: 'block' },
      viewer: { id: 41, username: 'dev' },
      context: { slotId: 'app.page' },
      storageMode: 'local-preview',
    });
    const app = await initialize({ transport, fetch });

    const error = await refusal(app.storage.collection('notes', { from: PARENT }).get('k'));
    expect(urls).toEqual([]);
    expect([error.status, error.code, error.details]).toEqual([403, 'not_eligible', { reason: 'import_dev_token' }]);
    expect(error.message).toMatch(/createFakeStorage\(\{ sources \}\)/);
    expect(storageImportRefusal(error)).toEqual({ kind: 'not_eligible', reason: 'import_dev_token' });
    await app.storage.collection('notes').put('k', { text: 'local' });
    expect((await app.storage.collection('notes').get('k'))?.data).toEqual({ text: 'local' });
  });
});
