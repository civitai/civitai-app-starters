import { afterEach, describe, expect, it, vi } from 'vitest';

import { initialize } from '../../src/app/index.js';
import {
  createDocumentStorage,
  StorageError,
  storageImportRefusal,
  type StorageImportNotEligibleReason,
} from '../../src/doc-store/index.js';
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
  const answer = (method: string, path: string, opts: RequestOptions) => {
    if (method === 'PATCH') {
      const op = opts.body as Record<string, unknown>;
      return '$inc' in op ? { value: 3 } : { marked: '$mark' in op, count: 1 };
    }
    if (path.startsWith('blocks/storage/_get/')) return { items: [WIRE_DOC] };
    if (method === 'DELETE') return { deleted: true };
    if (method === 'GET' && path === 'blocks/storage/notes') return { items: [], nextCursor: null };
    return WIRE_DOC;
  };
  const queryOf = (opts: RequestOptions) =>
    Object.fromEntries(Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined));

  it('sends ?from=<blockId> on get, getMany, put, create, delete, list, update, increment, mark and unmark — path, verb and body unchanged', async () => {
    const r = recorder(answer);
    const notes = r.storage.collection('notes', { from: PARENT });
    await notes.get('n1');
    await notes.getMany(['n1']);
    await notes.put('n1', { text: 'p' }, { ifVersion: 2 });
    await notes.create({ text: 'c' });
    await notes.delete('n1', { ifVersion: 3 });
    await notes.list({ sort: '-updatedAt', limit: 5 });
    await notes.update('n1', { $inc: { views: 4 } });
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
      ['PATCH', 'blocks/storage/notes/n1', { from: PARENT }, { $inc: { views: 4 } }],
      ['PATCH', 'blocks/storage/notes/n1', { from: PARENT }, { $inc: { views: 2 } }],
      ['PATCH', 'blocks/storage/notes/n1', { from: PARENT }, { $mark: 'vote' }],
      ['PATCH', 'blocks/storage/notes/n1', { from: PARENT }, { $unmark: 'vote' }],
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
    // The other two `resolveImportAccess` emits (civitai/civitai@86334b30): a mature-rated
    // source on a host that may not show it, and a token outside the published namespace.
    [err(403, 'not_eligible', { reason: 'import_source_rating' }), { kind: 'not_eligible', reason: 'import_source_rating' }],
    [err(403, 'not_eligible', { reason: 'import_namespace' }), { kind: 'not_eligible', reason: 'import_namespace' }],
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

  /** A store that refuses every call 403 `not_eligible` with `reason`. */
  const refusingWith = (reason: string) =>
    recorder(() => {
      const message = `not eligible (${reason})`;
      throw new ApiError(403, message, { code: 'not_eligible', message, error: message, details: { reason } });
    }).storage;

  it('a `not_eligible` reason this SDK does not know, on a call THROUGH AN IMPORT, is still typed — a newer server\'s reason is not dropped', async () => {
    const error = await refusal(refusingWith('a_reason_from_a_newer_server').collection('notes', { from: PARENT }).get('n1'));
    expect(storageImportRefusal(error)).toEqual({ kind: 'not_eligible', reason: 'a_reason_from_a_newer_server' });
  });

  // INVARIANT GUARDS, not regression coverage: these were `null` before the change too.
  // An unknown reason on this app's OWN collection is not an import's; and the reasons the
  // server gives for the consumer itself (its approval, the viewer's trust) are not import
  // refusals even when the refused call carried `from`.
  it.each([
    ['an unknown reason on this app\'s own collection', 'a_reason_from_a_newer_server', undefined],
    ['the consumer app not approved, through an import', 'app_not_approved', { from: PARENT }],
    ['apps disabled for the viewer, through an import', 'apps_disabled', { from: PARENT }],
    ['an account too new to write, through an import', 'account_too_new', { from: PARENT }],
  ])('null for %s', async (_what, reason, options) => {
    const error = await refusal(refusingWith(reason).collection('notes', options).get('n1'));
    expect(storageImportRefusal(error)).toBeNull();
  });

  it('`StorageImportNotEligibleReason` is open-ended: a reason this SDK does not list still type-checks', () => {
    // Compile-time: an exhaustive switch over the listed reasons must keep a default branch.
    const future: StorageImportNotEligibleReason = 'a_reason_from_a_newer_server';
    expect(future).toBe('a_reason_from_a_newer_server');
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

/**
 * Publish consent IN THE SOURCE (civitai/civitai#7586): a create, put, counter, mark or
 * unmark through a `readwrite` import into one of the source's SHARED collections, refused
 * 403 `consent_required` with `details: { scope: 'apps:storage:publish', from }`, asks the
 * host once — `REQUEST_CONSENT { scopes: ['apps:storage:publish'], from }` — and retries
 * ONCE on the next token refresh, within the 60 s consent wait. The grant is the source's,
 * so the consumer's token scopes do not change; the refresh itself is the answer.
 *
 * Through `initialize()` with a scripted host and `fetch`, so the seam under test is the
 * real one: the document-store client, the host session and the transport together.
 * Fixtures: the token's raw values before and after the refresh, the source blockId, the
 * document texts and the counter value are pairwise distinct.
 */
describe('the client: publish consent in the source — ask the host, then retry once', () => {
  const PUBLISH_IN_PARENT = { scope: 'apps:storage:publish', from: PARENT };
  const envelope = (code: string, details?: Record<string, unknown>) => ({
    code,
    message: `${code} (scripted)`,
    error: `${code} (scripted)`,
    ...(details ? { details } : {}),
  });
  const REFUSED = { status: 403, body: envelope('consent_required', PUBLISH_IN_PARENT) };
  const ASK = { type: 'REQUEST_CONSENT', payload: { scopes: ['apps:storage:publish'], from: PARENT } };

  async function setup(answers: { status: number; body: unknown }[]) {
    const calls: { method: string; url: string; body: unknown }[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        url: String(input),
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      const next = answers.shift() ?? { status: 500, body: envelope('internal_error') };
      return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const transport = createFakeTransport({
      token: { raw: 'fork-token-1', scopes: ['apps:storage', 'apps:storage:import'], expiresAt: new Date(0), kind: 'block' },
      viewer: { id: 7, username: 'alice' },
      context: { slotId: 'app.page' },
    });
    const app = await initialize({ transport, fetch });
    return {
      app,
      calls,
      transport,
      asks: () => transport.sent.filter((m) => m.type === 'REQUEST_CONSENT'),
      // The host's re-mint after Allow — or a routine one — pushed as `TOKEN_REFRESH`: a NEW
      // token, the SAME scopes. The transport applies it to the snapshot, then tells `on`.
      refresh: () => {
        const next = { ...transport.snapshot.get().token, raw: 'fork-token-2' };
        transport.setSnapshot({ token: next });
        transport.push('TOKEN_REFRESH', { token: next });
      },
      // The host's ANSWER to a `getToken({ fresh: true })` (`TOKEN_REFRESH_RESPONSE`): a new
      // token in the snapshot, and no push.
      answeredFresh: () => transport.setSnapshot({ token: { ...transport.snapshot.get().token, raw: 'fork-token-3' } }),
    };
  }

  const BASE_URL = 'https://civitai.com/api/v1/blocks/storage';
  const ops = [
    ['create', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).create({ t: 'c' }), 'POST', `${BASE_URL}/board?from=${PARENT}`, { data: { t: 'c' } }, WIRE_DOC],
    ['put', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).put('b1', { t: 'p' }), 'PUT', `${BASE_URL}/board/b1?from=${PARENT}`, { data: { t: 'p' } }, WIRE_DOC],
    ['increment', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('tally', { from: PARENT }).increment('m1', 'plays', 4), 'POST', `${BASE_URL}/tally/m1/counters/plays?from=${PARENT}`, { by: 4 }, { value: 9 }],
    ['mark', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).mark('b1', 'vote'), 'PUT', `${BASE_URL}/board/b1/marks/vote?from=${PARENT}`, undefined, { marked: true, count: 5 }],
    ['unmark', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).unmark('b1', 'vote'), 'DELETE', `${BASE_URL}/board/b1/marks/vote?from=${PARENT}`, undefined, { marked: false, count: 4 }],
  ] as const;

  it.each(ops)('%s: asks once with { scopes, from }, waits for the refresh, then sends the SAME request once more', async (_op, run, method, url, body, reply) => {
    const s = await setup([REFUSED, { status: 200, body: reply }]);
    const pending = run(s);
    await vi.waitFor(() => expect(s.asks()).toEqual([ASK]));
    // Nothing is retried before the host answers.
    expect(s.calls).toHaveLength(1);

    s.refresh();
    const result = await pending;
    expect(s.calls.map((c) => [c.method, c.url, c.body])).toEqual([
      [method, url, body],
      [method, url, body],
    ]);
    expect(s.asks()).toHaveLength(1);
    if ('value' in reply) expect(result).toEqual({ value: 9 });
    else if ('marked' in reply) expect(result).toMatchObject({ marked: reply.marked, count: reply.count });
    else expect(result).toMatchObject({ key: WIRE_DOC.key, data: WIRE_DOC.data });
  });

  it('CONSENT_UNAVAILABLE ends it at once: the original refusal surfaces, nothing is retried', async () => {
    const s = await setup([REFUSED]);
    const pending = refusal(s.app.storage.collection('board', { from: PARENT }).create({ t: 'u' }));
    await vi.waitFor(() => expect(s.asks()).toEqual([ASK]));
    s.transport.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['apps:storage:publish'] });

    const error = await pending;
    expect([error.status, error.code, error.details]).toEqual([403, 'consent_required', PUBLISH_IN_PARENT]);
    s.refresh();
    await Promise.resolve();
    expect(s.calls).toHaveLength(1);
  });

  it('"Not now" sends nothing: after the 60 s consent wait the original refusal surfaces, and a late refresh retries nothing', async () => {
    const s = await setup([REFUSED]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let settled: StorageError | undefined;
      void refusal(s.app.storage.collection('board', { from: PARENT }).create({ t: 'n' })).then((e) => (settled = e));
      for (let i = 0; i < 20 && s.asks().length === 0; i++) await vi.advanceTimersByTimeAsync(0);
      expect(s.asks()).toEqual([ASK]);

      await vi.advanceTimersByTimeAsync(59_000);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_000);
      expect([settled?.code, settled?.details]).toEqual(['consent_required', PUBLISH_IN_PARENT]);

      s.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fresh token the app ASKED for while the prompt is open is not an Allow: nothing is retried', async () => {
    const s = await setup([REFUSED, { status: 200, body: WIRE_DOC }]);
    const pending = refusal(s.app.storage.collection('board', { from: PARENT }).create({ t: 'f' }));
    await vi.waitFor(() => expect(s.asks()).toEqual([ASK]));

    s.answeredFresh();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(s.calls).toHaveLength(1);

    s.transport.push('CONSENT_UNAVAILABLE', { reason: 'ungrantable', scopes: ['apps:storage:publish'] });
    expect([(await pending).code, s.calls.length, s.asks().length]).toEqual(['consent_required', 1, 1]);
  });

  // INVARIANT GUARD, not regression coverage: the retry was bounded to one before the change.
  // A routine re-mint pushed while the prompt is open is indistinguishable from an Allow (the
  // host sends nothing on "Not now"), so it costs exactly one retry — whose refusal surfaces —
  // and never a second prompt or a loop.
  it('a routine re-mint while the prompt is open (no Allow): exactly one retry, then ITS refusal, never a second prompt', async () => {
    const SECOND = { status: 403, body: { ...envelope('consent_required', PUBLISH_IN_PARENT), message: 'refused again (scripted)' } };
    const s = await setup([REFUSED, SECOND, { status: 200, body: WIRE_DOC }]);
    const pending = refusal(s.app.storage.collection('board', { from: PARENT }).create({ t: 'r' }));
    await vi.waitFor(() => expect(s.asks()).toEqual([ASK]));

    s.refresh();
    const error = await pending;
    expect([error.code, error.message]).toEqual(['consent_required', 'refused again (scripted)']);
    s.refresh();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect([s.calls.length, s.asks().length]).toEqual([2, 1]);
  });

  it('a second refusal after the retry is final: two requests, one ask, no loop', async () => {
    const s = await setup([REFUSED, REFUSED]);
    const pending = refusal(s.app.storage.collection('board', { from: PARENT }).put('b2', { t: 'twice' }));
    await vi.waitFor(() => expect(s.asks()).toHaveLength(1));
    s.refresh();

    expect((await pending).code).toBe('consent_required');
    expect(s.calls).toHaveLength(2);
    expect(s.asks()).toHaveLength(1);
  });

  it('a caller abort during the wait rejects with the abort, and the refresh retries nothing', async () => {
    const s = await setup([REFUSED, { status: 200, body: WIRE_DOC }]);
    const ac = new AbortController();
    const pending = s.app.storage.collection('board', { from: PARENT }).create({ t: 'a' }, { signal: ac.signal });
    await vi.waitFor(() => expect(s.asks()).toHaveLength(1));
    ac.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    s.refresh();
    await Promise.resolve();
    expect(s.calls).toHaveLength(1);
  });

  // INVARIANT GUARDS, not regression coverage: none of these asked before the change either.
  // They pin the predicate's edges: a delete never needs the grant, reads never write, the
  // app's OWN publish scope (no `from`) keeps its existing path, and a refusal naming a
  // different source than this collection imports from is not this import's.
  it.each([
    ['a delete', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).delete('b1'), REFUSED],
    ['a read', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).list(), REFUSED],
    ['this app\'s own collection', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board').create({ t: 'own' }), { status: 403, body: envelope('consent_required', { scope: 'apps:storage:publish' }) }],
    ['a refusal naming another source', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).create({ t: 'x' }), { status: 403, body: envelope('consent_required', { scope: 'apps:storage:publish', from: 'other-app' }) }],
    ['the import scope', (s: Awaited<ReturnType<typeof setup>>) => s.app.storage.collection('board', { from: PARENT }).create({ t: 'i' }), { status: 403, body: envelope('consent_required', { scope: 'apps:storage:import', from: PARENT }) }],
  ])('%s refused consent_required does not ask the host', async (_what, run, answer) => {
    const s = await setup([answer]);
    expect((await refusal(run(s))).code).toBe('consent_required');
    expect(s.asks()).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });
});

describe('the fake: the publish prompt for the source, through `requestGrants`', () => {
  const withoutPublishInParent = (requestGrants: FakeStorageOptions['requestGrants']) =>
    forkAndParent({
      sources: { [PARENT]: { manifest: PARENT_MANIFEST, consent: { revoked: ['apps:storage:publish'] } } },
      requestGrants,
    });

  it('Allow records the grant IN THE PARENT and the write lands there on the one retry; the next write needs no prompt', async () => {
    const asked: unknown[] = [];
    const fake = withoutPublishInParent((scopes, opts) => {
      asked.push([scopes, opts.from]);
      return true;
    });
    const board = fake.storage.collection('board', { from: PARENT });
    const first = await board.create({ t: 'allowed' });
    await board.mark(first.key, 'vote');

    expect(asked).toEqual([[['apps:storage:publish'], PARENT]]);
    const inParent = await fake.as({ app: PARENT }).storage.collection('board').get(first.key);
    expect(inParent?.data).toEqual({ t: 'allowed' });
    expect(inParent?.marks).toEqual({ vote: 1 });
  });

  it('"Not now" surfaces the original refusal and writes nothing in the parent', async () => {
    const fake = withoutPublishInParent(() => false);
    const error = await refusal(fake.storage.collection('board', { from: PARENT }).create({ t: 'declined' }));
    expect([error.code, error.details]).toEqual(['consent_required', { scope: 'apps:storage:publish', from: PARENT }]);
    expect((await fake.as({ app: PARENT }).storage.collection('board').list()).items).toEqual([]);
  });

  // INVARIANT GUARD: without `requestGrants` nothing is asked, as before.
  it('without `requestGrants` the refusal surfaces as before', async () => {
    const fake = withoutPublishInParent(undefined);
    expect((await refusal(fake.storage.collection('board', { from: PARENT }).create({ t: 'n' }))).code).toBe('consent_required');
  });
});

/**
 * The SOURCE collection's schema governs a write through an import, even when the fork
 * declares its OWN collection of the same name with a conflicting schema. INVARIANT GUARD,
 * not regression coverage: the fake already resolved the source's declaration. The two
 * schemas accept disjoint bodies, so a write checked against the wrong one flips both ways.
 */
describe('the fake: an import is validated against the SOURCE collection\'s schema', () => {
  const PARENT_NOTES_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  };
  const FORK_NOTES_SCHEMA = {
    type: 'object',
    properties: { count: { type: 'integer' } },
    required: ['count'],
    additionalProperties: false,
  };
  const withConflictingSchemas = () =>
    forkAndParent({
      manifest: {
        ...FORK_MANIFEST,
        storage: { ...FORK_MANIFEST.storage, collections: { notes: { visibility: 'private', schema: FORK_NOTES_SCHEMA } } },
      },
      sources: {
        [PARENT]: {
          manifest: {
            ...PARENT_MANIFEST,
            storage: {
              collections: { ...PARENT_MANIFEST.storage.collections, notes: { visibility: 'private', schema: PARENT_NOTES_SCHEMA } },
            },
          },
        },
      },
    });

  it('a body only the SOURCE schema accepts is written through the import, into the source', async () => {
    const fake = withConflictingSchemas();
    await fake.storage.collection('notes', { from: PARENT }).put('s1', { text: 'parent-shaped' });
    expect((await fake.as({ app: PARENT }).storage.collection('notes').get('s1'))?.data).toEqual({ text: 'parent-shaped' });
    // The fork's own collection of that name refuses the same body, and holds nothing.
    expect((await refusal(fake.storage.collection('notes').put('s1', { text: 'parent-shaped' }))).code).toBe('schema_violation');
    expect(await fake.storage.collection('notes').get('s1')).toBeNull();
  });

  it('a body only the FORK\'s schema accepts is refused through the import 400 `schema_violation`, and nothing lands', async () => {
    const fake = withConflictingSchemas();
    const error = await refusal(fake.storage.collection('notes', { from: PARENT }).put('s2', { count: 7 }));
    expect([error.status, error.code, error.details?.collection]).toEqual([400, 'schema_violation', 'notes']);
    expect(await fake.as({ app: PARENT }).storage.collection('notes').get('s2')).toBeNull();
    // The same body is fine in the fork's own collection.
    await fake.storage.collection('notes').put('s2', { count: 7 });
    expect((await fake.storage.collection('notes').get('s2'))?.data).toEqual({ count: 7 });
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
