import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import {
  createDocumentStorage,
  StorageError,
  storageViewerKeyedRefusal,
  type StorageViewerKeyedRefusalReason,
} from '../../src/doc-store/index.js';
import { ApiError, type Http, type RequestOptions } from '../../src/http/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';
import { jsonResponse } from '../support/wire.js';

/**
 * VIEWER-KEYED documents (civitai/civitai#10216; `docs/app-storage-generic-core.md`, "Viewer-keyed
 * documents"): `getMine` / `putMine` / `deleteMine` at `…/:c/@me[/:parent]`, `parentOf`, the
 * new refusals, and the fake's semantics. The vendored storage contract has no viewer-keyed
 * cases yet, so the server's answers are pinned here as fixtures copied from its source
 * (`doc-store-viewer-keyed.ts`, `viewerKeyedRoute` and `run` in `doc-store-api.ts`, civitai main
 * 79a4a44930): each `[status, code, details]` below is what that code sends.
 */

/** An `Http` that records what the client sent and answers from a script. */
function recorder(answer: (method: string, path: string, opts: RequestOptions) => unknown = () => WIRE_DOC) {
  const sent: { method: string; path: string; opts: RequestOptions }[] = [];
  const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
    sent.push({ method, path, opts });
    const out = answer(method, path, opts);
    if (out instanceof Error) throw out;
    return out;
  }) as Http;
  return { http, sent, storage: createDocumentStorage(http) };
}

const DIGEST = 'gq4z7m2k5w6c3t6y7b2d4f7h3j';
/** A wire document whose key is a `parent+viewer` key, every field pairwise distinct. */
const WIRE_DOC = {
  key: `r7:${DIGEST}`,
  data: { value: 1 },
  version: 4,
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:05:00.000Z',
  author: { kind: 'user', isViewer: true },
  counters: {},
  marks: {},
  viewer: { marks: [] },
};

const envelope = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(status, message, { code, message, error: message, ...(details ? { details } : {}) });

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error as StorageError,
  );

describe('request shapes', () => {
  it('getMine: `@me` without a parent, `@me/:parent` with one; no key is ever sent', async () => {
    const r = recorder();
    await r.storage.collection('votes').getMine();
    await r.storage.collection('votes').getMine('r7');
    expect(r.sent.map((s) => [s.method, s.path])).toEqual([
      ['GET', 'blocks/storage/votes/@me'],
      ['GET', 'blocks/storage/votes/@me/r7'],
    ]);
    expect(r.sent.every((s) => s.opts.body === undefined)).toBe(true);
  });

  it('putMine sends exactly `{ data, ifVersion }` — `ifVersion: 0` kept, an absent one dropped', async () => {
    const r = recorder();
    await r.storage.collection('votes').putMine({ value: 1 }, { parent: 'r7', ifVersion: 0 });
    await r.storage.collection('votes').putMine({ value: -1 });
    expect(r.sent.map((s) => [s.method, s.path, JSON.stringify(s.opts.body)])).toEqual([
      ['PUT', 'blocks/storage/votes/@me/r7', '{"data":{"value":1},"ifVersion":0}'],
      ['PUT', 'blocks/storage/votes/@me', '{"data":{"value":-1}}'],
    ]);
  });

  it('deleteMine: `ifVersion` in the query, `{ deleted }` read back strictly', async () => {
    const r = recorder(() => ({ deleted: false }));
    expect(await r.storage.collection('votes').deleteMine({ parent: 'r7', ifVersion: 3 })).toEqual({ deleted: false });
    expect(r.sent[0]).toMatchObject({ method: 'DELETE', path: 'blocks/storage/votes/@me/r7', opts: { query: { ifVersion: 3 } } });

    const bad = recorder(() => ({}));
    await expect(bad.storage.collection('votes').deleteMine()).rejects.toThrow(/no `deleted` flag/);
  });

  it('through an import every `@me` call carries `?from=`', async () => {
    const r = recorder((method) => (method === 'DELETE' ? { deleted: true } : WIRE_DOC));
    const votes = r.storage.collection('votes', { from: 'parent-app' });
    await votes.getMine('r7');
    await votes.putMine({ value: 1 }, { parent: 'r7' });
    await votes.deleteMine({ parent: 'r7' });
    expect(r.sent.map((s) => s.opts.query?.from)).toEqual(['parent-app', 'parent-app', 'parent-app']);
  });

  it('the document comes back revived, its key opaque and untouched', async () => {
    const r = recorder();
    const doc = await r.storage.collection('votes').getMine('r7');
    expect(doc).toMatchObject({ key: `r7:${DIGEST}`, version: 4, data: { value: 1 } });
    expect(doc?.createdAt).toEqual(new Date('2026-11-23T10:00:00.000Z'));
  });
});

describe('a parent: only what no URL can carry is refused before sending; the server judges the rest', () => {
  // `''` collapses the segment (reaching `@me` alone), `.` and `..` are path steps.
  const unaddressable: unknown[] = ['', '.', '..', null, 7];
  // Sent encoded; the server answers them (mode first, then its grammar).
  const sent: [string, string][] = [
    ['a', 'a'],
    ['.a', '.a'],
    ['...', '...'],
    ['a:b', 'a%3Ab'],
    ['a/b', 'a%2Fb'],
    ['a b', 'a%20b'],
    ['é', '%C3%A9'],
    ['x'.repeat(96), 'x'.repeat(96)],
    ['x'.repeat(97), 'x'.repeat(97)],
  ];

  it.each(unaddressable.map((p) => [JSON.stringify(p), p]))('%s is invalid_request / invalid_parent, nothing sent', async (_, parent) => {
    const r = recorder();
    const votes = r.storage.collection('votes');
    for (const call of [
      () => votes.getMine(parent as string),
      () => votes.putMine({ value: 1 }, { parent: parent as string }),
      () => votes.deleteMine({ parent: parent as string }),
    ]) {
      const error = await refusal(call());
      expect(error).toBeInstanceOf(StorageError);
      expect([error.status, error.code, error.details]).toEqual([400, 'invalid_request', { reason: 'invalid_parent', collection: 'votes' }]);
      expect(storageViewerKeyedRefusal(error)).toEqual({ reason: 'invalid_parent', collection: 'votes' });
    }
    expect(r.sent).toEqual([]);
  });

  it.each(sent)('%s is sent as one encoded segment', async (parent, segment) => {
    const r = recorder();
    await r.storage.collection('votes').getMine(parent);
    expect(r.sent.map((s) => s.path)).toEqual([`blocks/storage/votes/@me/${segment}`]);
  });

  it('the server (here, the fake) checks the mode BEFORE the grammar', async () => {
    const fake = fakeWith();
    const reason = async (p: Promise<unknown>) => storageViewerKeyedRefusal(await refusal(p))?.reason;
    // The same bad parent: `parent_not_allowed` on a `viewer` collection, `not_viewer_keyed` on
    // an ordinary one, `invalid_parent` only where a parent belongs.
    expect(await reason(fake.storage.collection('picks').getMine('a:b'))).toBe('parent_not_allowed');
    expect(await reason(fake.storage.collection('records').getMine('a:b'))).toBe('not_viewer_keyed');
    expect(await reason(fake.storage.collection('votes').getMine('a:b'))).toBe('invalid_parent');
    expect(await reason(fake.storage.collection('votes').getMine('x'.repeat(97)))).toBe('invalid_parent');
    expect(await reason(fake.storage.collection('votes').getMine('...'))).toBe('invalid_parent');
  });

  it('a bad collection name is refused before the parent is looked at', async () => {
    const r = recorder();
    const error = await refusal(r.storage.collection('_get').getMine(''));
    expect(error.code).toBe('collection_not_declared');
    expect(r.sent).toEqual([]);
  });
});

describe('getMine reads only a DOCUMENT miss as null', () => {
  it('404 not_found "document not found" (the server\'s miss) is null', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'document not found'));
    expect(await r.storage.collection('votes').getMine('r7')).toBeNull();
  });

  it('404 not_found "no such storage route" (a civitai.com without `@me`) rejects, never "not voted"', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'no such storage route'));
    const error = await refusal(r.storage.collection('votes').getMine('r7'));
    expect([error.status, error.code]).toEqual([404, 'not_found']);
  });

  it('any other 404 not_found sentence rejects too: only the exact miss reads as "none yet"', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'Document not found.'));
    expect((await refusal(r.storage.collection('votes').getMine('r7'))).code).toBe('not_found');
  });

  it('a 404 without the storage envelope (no such page) rejects as a plain ApiError', async () => {
    const r = recorder(() => new ApiError(404, 'Not Found', '<html>404</html>'));
    const error = await refusal(r.storage.collection('votes').getMine('r7'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(StorageError);
  });

  it('a 404 `collection_not_declared` rejects', async () => {
    const r = recorder(() => envelope(404, 'collection_not_declared', 'collection votes is not declared', { collection: 'votes' }));
    expect((await refusal(r.storage.collection('votes').getMine())).code).toBe('collection_not_declared');
  });
});

/**
 * The server's refusals, as `doc-store-viewer-keyed.ts` and `run` send them. Each row is
 * `[reason, status, code, message, details]`.
 */
const SERVER_REFUSALS: [StorageViewerKeyedRefusalReason, number, string, string, Record<string, unknown> | undefined][] = [
  ['viewer_keyed', 400, 'invalid_request', 'writing by key is not available on viewer-keyed collection votes: write the viewer\'s own document at /votes/@me', { reason: 'viewer_keyed', collection: 'votes' }],
  ['not_viewer_keyed', 400, 'invalid_request', 'collection votes is not viewer-keyed: address its documents by key', { reason: 'not_viewer_keyed', collection: 'votes' }],
  ['parent_required', 400, 'invalid_request', 'collection votes is keyed by parent and viewer: use /votes/@me/:parent', { reason: 'parent_required', collection: 'votes' }],
  ['parent_not_allowed', 400, 'invalid_request', 'collection votes is keyed by viewer only: use /votes/@me', { reason: 'parent_not_allowed', collection: 'votes' }],
  ['invalid_parent', 400, 'invalid_request', 'parent must be 1–96 characters of [A-Za-z0-9._-], not only dots', { reason: 'invalid_parent', collection: 'votes' }],
  ['viewer_keyed_closed', 403, 'write_policy', 'this collection is not open for writes yet', { collection: 'votes', reason: 'viewer_keyed_closed' }],
  ['viewer_keys_unconfigured', 503, 'service_unavailable', 'storage is temporarily unavailable', { reason: 'viewer_keys_unconfigured' }],
  ['sign_in_required', 401, 'sign_in_required', 'sign in required', undefined],
];

describe('the server\'s refusals reach the caller as StorageErrors, typed by storageViewerKeyedRefusal', () => {
  it.each(SERVER_REFUSALS)('%s', async (reason, status, code, message, details) => {
    const r = recorder(() => envelope(status, code, message, details));
    const error = await refusal(r.storage.collection('votes').putMine({ value: 1 }, { parent: 'r7' }));
    expect(error).toBeInstanceOf(StorageError);
    expect([error.status, error.code, error.message, error.details]).toEqual([status, code, message, details]);
    const typed = storageViewerKeyedRefusal(error);
    expect(typed?.reason).toBe(reason);
    expect(typed?.collection).toBe(details?.collection);
  });

  it('a reason under another code is not this refusal', async () => {
    const r = recorder(() => envelope(403, 'write_policy', 'x', { reason: 'parent_required' }));
    expect(storageViewerKeyedRefusal(await refusal(r.storage.collection('votes').putMine({ value: 1 })))).toBeNull();
  });

  it('sign_in_required is a viewer-keyed refusal only on a `…Mine` call', async () => {
    const r = recorder(() => envelope(401, 'sign_in_required', 'sign in required'));
    const byKey = await refusal(r.storage.collection('votes').put('k', { value: 1 }));
    const info = await refusal(r.storage.info());
    const mine = await refusal(r.storage.collection('votes').deleteMine());
    expect([byKey.code, info.code, mine.code]).toEqual(['sign_in_required', 'sign_in_required', 'sign_in_required']);
    expect([storageViewerKeyedRefusal(byKey), storageViewerKeyedRefusal(info), storageViewerKeyedRefusal(mine)]).toEqual([
      null,
      null,
      { reason: 'sign_in_required' },
    ]);
  });

  it('anything that is not a StorageError is null', () => {
    expect(storageViewerKeyedRefusal(new Error('x'))).toBeNull();
    expect(storageViewerKeyedRefusal({ code: 'invalid_request', details: { reason: 'viewer_keyed' } })).toBeNull();
  });
});

describe('parentOf', () => {
  const votes = recorder().storage.collection('votes');
  it.each([
    [`r7:${DIGEST}`, 'r7'],
    [`01JD3Q8M5Z4X2V7K9C6B1N0RTA:${DIGEST}`, '01JD3Q8M5Z4X2V7K9C6B1N0RTA'],
    [`${'p'.repeat(96)}:${DIGEST}`, 'p'.repeat(96)],
    [`.a:${DIGEST}`, '.a'],
  ])('%s → %s', (key, parent) => {
    expect(votes.parentOf(key)).toBe(parent);
  });

  it.each([
    DIGEST, // a `viewer` collection's key
    'r7', // an ordinary key
    `r7:${DIGEST.toUpperCase()}`, // not the digest alphabet
    `r7:${DIGEST}a`, // 27 characters
    `r7:${DIGEST.slice(1)}`, // 25 characters
    `r7:${DIGEST.slice(0, 25)}1`, // `1` is not base32
    `a:b:${DIGEST}`, // a parent never has `:`
    `:${DIGEST}`, // an empty parent
    `..:${DIGEST}`, // only dots
    `${'p'.repeat(97)}:${DIGEST}`, // too long
  ])('%s → null', (key) => {
    expect(votes.parentOf(key)).toBeNull();
  });

  it('sends nothing', () => {
    const r = recorder();
    r.storage.collection('votes').parentOf(`r7:${DIGEST}`);
    expect(r.sent).toEqual([]);
  });
});

describe('info passes keyedBy and open through', () => {
  it('a viewer-keyed collection carries both; another collection neither', async () => {
    const reply = {
      collections: {
        votes: { kind: 'docs', visibility: 'shared', write: 'own', counters: [], marks: [], indexes: {}, showAuthor: false, keyedBy: 'parent+viewer', open: false },
        posts: { kind: 'docs', visibility: 'shared', write: 'own', counters: [], marks: [], indexes: {}, showAuthor: false },
      },
      limits: {},
      usage: {},
    };
    const r = recorder(() => reply);
    const info = await r.storage.info();
    expect(info.collections.votes).toMatchObject({ keyedBy: 'parent+viewer', open: false });
    expect('keyedBy' in info.collections.posts!).toBe(false);
  });
});

describe('wiring', () => {
  it('app.storage.collection(c).putMine reaches /api/v1/blocks/storage/:c/@me/:parent', async () => {
    const seen: { url: string; method?: string }[] = [];
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ url: String(input), method: init.method });
      return jsonResponse(200, WIRE_DOC);
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 'tok', fetch });
    await app.storage.collection('votes').putMine({ value: 1 }, { parent: 'r7' });
    expect(seen).toEqual([{ url: 'https://civitai.com/api/v1/blocks/storage/votes/@me/r7', method: 'PUT' }]);
  });
});

// ---------------------------------------------------------------------------
// The fake (and so the local preview): the same semantics
// ---------------------------------------------------------------------------

const MANIFEST = {
  scopes: ['apps:storage', 'apps:storage:publish'],
  storage: {
    collections: {
      records: { visibility: 'shared', write: 'own' },
      votes: { visibility: 'shared', write: 'own', keyedBy: 'parent+viewer' },
      picks: { visibility: 'shared', write: 'own', keyedBy: 'viewer' },
      notes: { visibility: 'private' },
    },
  },
};

const fakeWith = (extra: Partial<FakeStorageOptions> = {}) =>
  createFakeStorage({ manifest: MANIFEST, viewer: { username: 'ann', id: 987_654 }, ...extra });

describe('fake: one document per viewer per parent, at an opaque key', () => {
  it('a second putMine for the same parent replaces the first; another parent is another document', async () => {
    const fake = fakeWith();
    const votes = fake.storage.collection<{ value: number }>('votes');
    const first = await votes.putMine({ value: 1 }, { parent: 'r1' });
    const again = await votes.putMine({ value: -1 }, { parent: 'r1' });
    const other = await votes.putMine({ value: 1 }, { parent: 'r2' });

    expect(again.key).toBe(first.key);
    expect([first.version, again.version, again.data.value]).toEqual([1, 2, -1]);
    expect(other.key).not.toBe(first.key);
    expect(votes.parentOf(first.key)).toBe('r1');
    expect(votes.parentOf(other.key)).toBe('r2');
    expect(await votes.getMine('r1')).toMatchObject({ key: first.key, version: 2, author: { kind: 'user', isViewer: true } });
  });

  it('the key is `<parent>:<26 base32>` and carries neither the username nor the user id', async () => {
    const fake = fakeWith();
    const { key } = await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    expect(key).toMatch(/^r1:[a-z2-7]{26}$/);
    expect(key).not.toContain('ann');
    expect(key).not.toContain('987654');
    const { key: solo } = await fake.storage.collection('picks').putMine({ pick: 'a' });
    expect(solo).toMatch(/^[a-z2-7]{26}$/);
  });

  it('two viewers get two documents under one parent; keyPrefix lists exactly that parent', async () => {
    const fake = fakeWith();
    const bob = fake.as({ viewer: { username: 'bob' } }).storage.collection('votes');
    const ann = fake.storage.collection('votes');
    const a = await ann.putMine({ value: 1 }, { parent: 'r1' });
    const b = await bob.putMine({ value: 1 }, { parent: 'r1' });
    await ann.putMine({ value: 1 }, { parent: 'r10' });

    expect(a.key).not.toBe(b.key);
    const page = await ann.list({ keyPrefix: 'r1:' });
    expect(page.items.map((d) => d.key).sort()).toEqual([a.key, b.key].sort());
    expect((await ann.list({ author: 'me' })).items).toHaveLength(2);
    expect((await bob.getMine('r1'))?.key).toBe(b.key);
  });

  it('deleteMine deletes only the viewer\'s own, idempotently; `ifVersion` as a delete', async () => {
    const fake = fakeWith();
    const votes = fake.storage.collection('votes');
    await votes.putMine({ value: 1 }, { parent: 'r1' });
    await fake.as({ viewer: { username: 'bob' } }).storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });

    expect((await refusal(votes.deleteMine({ parent: 'r1', ifVersion: 9 }))).details).toEqual({ currentVersion: 1 });
    expect(await votes.deleteMine({ parent: 'r1' })).toEqual({ deleted: true });
    expect(await votes.deleteMine({ parent: 'r1' })).toEqual({ deleted: false });
    expect(await votes.getMine('r1')).toBeNull();
    expect((await votes.list({ keyPrefix: 'r1:' })).items).toHaveLength(1);
  });

  it('`ifVersion: 0` writes only when the viewer has none yet', async () => {
    const votes = fakeWith().storage.collection('votes');
    await votes.putMine({ value: 1 }, { parent: 'r1', ifVersion: 0 });
    const error = await refusal(votes.putMine({ value: 1 }, { parent: 'r1', ifVersion: 0 }));
    expect([error.code, error.details]).toEqual(['version_conflict', { currentVersion: 1 }]);
  });

  it('the derived key differs per collection and per namespace', async () => {
    const fake = fakeWith({
      manifest: {
        ...MANIFEST,
        storage: { collections: { ...MANIFEST.storage.collections, ballots: { visibility: 'shared', write: 'own', keyedBy: 'parent+viewer' } } },
      },
    });
    const v = await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    const b = await fake.storage.collection('ballots').putMine({ value: 1 }, { parent: 'r1' });
    const dev = await fake.as({ token: 'dev' }).storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    expect(new Set([v.key, b.key, dev.key]).size).toBe(3);
  });
});

describe('fake: refusals in the server\'s order', () => {
  it('a create, put or delete BY KEY on a viewer-keyed collection is viewer_keyed (400)', async () => {
    const votes = fakeWith().storage.collection('votes');
    for (const call of [() => votes.create({ value: 1 }), () => votes.put('r1:x', { value: 1 }), () => votes.delete('r1:x')]) {
      const error = await refusal(call());
      expect([error.status, error.code, error.details]).toEqual([400, 'invalid_request', { reason: 'viewer_keyed', collection: 'votes' }]);
    }
    // Reads by key are unchanged.
    expect(await votes.get('r1:x')).toBeNull();
  });

  it('not_viewer_keyed, parent_required, parent_not_allowed — through the raw seam too', async () => {
    const fake = fakeWith();
    const reasons = async (p: Promise<unknown>) => storageViewerKeyedRefusal(await refusal(p))?.reason;
    expect(await reasons(fake.storage.collection('records').getMine())).toBe('not_viewer_keyed');
    expect(await reasons(fake.storage.collection('votes').putMine({ value: 1 }))).toBe('parent_required');
    expect(await reasons(fake.storage.collection('picks').getMine('r1'))).toBe('parent_not_allowed');
    // A parent only a URL-level client would send: the fake checks it too.
    const raw = await fake.http('GET', 'blocks/storage/votes/@me/a%3Ab').catch((e: ApiError) => e);
    expect((raw as ApiError).body).toMatchObject({ code: 'invalid_request', details: { reason: 'invalid_parent' } });
  });

  it('an anonymous viewer is refused every `@me` call, reads included; reads by list still work', async () => {
    const fake = fakeWith();
    await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    const anon = fake.as({ viewer: null }).storage.collection('votes');
    for (const p of [anon.getMine('r1'), anon.putMine({ value: 1 }, { parent: 'r1' }), anon.deleteMine({ parent: 'r1' })]) {
      const error = await refusal(p);
      expect([error.status, error.code]).toEqual([401, 'sign_in_required']);
      expect(storageViewerKeyedRefusal(error)).toEqual({ reason: 'sign_in_required' });
    }
    expect((await anon.list({ keyPrefix: 'r1:' })).items).toHaveLength(1);
  });

  it('putMine needs apps:storage:publish; deleteMine does not', async () => {
    const fake = fakeWith();
    await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    const noPublish = fake.as({ scopes: ['apps:storage'] }).storage.collection('votes');
    expect((await refusal(noPublish.putMine({ value: 1 }, { parent: 'r1' }))).code).toBe('consent_required');
    expect(await noPublish.deleteMine({ parent: 'r1' })).toEqual({ deleted: true });
  });

  it('a closed switch refuses writes 403 viewer_keyed_closed, keeps reads, and reads as open: false', async () => {
    const fake = fakeWith({ viewerKeyedClosed: ['votes'] });
    const votes = fake.storage.collection('votes');
    for (const p of [votes.putMine({ value: 1 }, { parent: 'r1' }), votes.deleteMine({ parent: 'r1' })]) {
      const error = await refusal(p);
      expect([error.status, error.code, error.details]).toEqual([403, 'write_policy', { collection: 'votes', reason: 'viewer_keyed_closed' }]);
    }
    expect(await votes.getMine('r1')).toBeNull();
    const info = await fake.storage.info();
    expect([info.collections.votes!.open, info.collections.picks!.open]).toEqual([false, true]);
    // A development namespace has no switches, as on the server.
    expect((await fake.as({ token: 'dev' }).storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' })).version).toBe(1);
  });

  it('keys not derivable: every `@me` call is 503 viewer_keys_unconfigured and info says open: false', async () => {
    const fake = fakeWith({ viewerKeysUnconfigured: true });
    const error = await refusal(fake.storage.collection('votes').getMine('r1'));
    expect([error.status, error.code, error.details]).toEqual([503, 'service_unavailable', { reason: 'viewer_keys_unconfigured' }]);
    expect(storageViewerKeyedRefusal(error)).toEqual({ reason: 'viewer_keys_unconfigured' });
    const info = await fake.storage.info();
    expect(info.collections.votes).toMatchObject({ keyedBy: 'parent+viewer', open: false });
    expect('open' in info.collections.records!).toBe(false);
  });

  it('counters, marks (but not a report) and publish are refused on a viewer-keyed collection', async () => {
    const fake = fakeWith({ publish: true });
    const votes = fake.storage.collection('votes');
    const { key } = await votes.putMine({ value: 1 }, { parent: 'r1' });
    expect((await refusal(votes.update(key, { $mark: 'vote' }))).details).toEqual({ reason: 'viewer_keyed', collection: 'votes' });
    expect((await refusal(votes.update(key, { $inc: { n: 1 } }))).details).toEqual({ reason: 'viewer_keyed', collection: 'votes' });
    expect(await votes.update(key, { $mark: 'report' })).toEqual({ marked: true });
    await fake.storage.collection('notes').put('n1', { a: 1 });
    expect((await refusal(votes.publish({ from: 'notes', keys: ['n1'] }))).details).toEqual({ reason: 'viewer_keyed', collection: 'votes' });
  });

  it('moderation scans the data and the PARENT, never the derived key', async () => {
    // A scanner that refuses every string shaped like a digest, so scanning the key would refuse.
    const moderate = (text: string) => (/^[a-z2-7]{26}$|:[a-z2-7]{26}$/.test(text) || text === 'bad-parent' ? 'blocked' : null);
    const fake = fakeWith({ moderate });
    const votes = fake.storage.collection('votes');
    expect((await votes.putMine({ value: 1 }, { parent: 'r1' })).version).toBe(1);
    expect((await refusal(votes.putMine({ value: 1 }, { parent: 'bad-parent' }))).code).toBe('content_rejected');
    // Positive control: the same scanner DOES refuse a key of that shape on a put by key.
    expect((await refusal(fake.storage.collection('records').put(`r1:${DIGEST}`, { value: 1 }))).code).toBe('content_rejected');
  });

  it('the `@me` path is what reached the fake, and no key was in it', async () => {
    const fake = fakeWith();
    await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    expect(fake.calls.map((c) => [c.method, c.path, c.status])).toEqual([['PUT', 'blocks/storage/votes/@me/r1', 200]]);
  });
});

describe('fake: the manifest\'s keyedBy rules, with the server\'s texts', () => {
  const build = (decl: Record<string, unknown>) => () =>
    createFakeStorage({ manifest: { scopes: ['apps:storage'], storage: { collections: { c: decl } } } });

  it.each([
    [{ visibility: 'private', keyedBy: 'viewer' }, 'storage.collections.c.keyedBy applies only to shared collections'],
    [{ visibility: 'shared', write: 'none', keyedBy: 'viewer' }, 'storage.collections.c.keyedBy applies only to write "own"'],
    [{ visibility: 'shared', write: 'own', keyedBy: 'viewer', marks: ['vote'] }, 'cannot be combined with counters or marks'],
    [{ visibility: 'shared', write: 'own', keyedBy: 'owner' }, 'storage.collections.c.keyedBy must be one of viewer, parent+viewer'],
  ])('%j is refused', (decl, text) => {
    expect(build(decl)).toThrow(text);
  });

  it('both modes are accepted on a shared `own` collection', () => {
    expect(build({ visibility: 'shared', write: 'own', keyedBy: 'viewer' })).not.toThrow();
    expect(build({ visibility: 'shared', write: 'own', keyedBy: 'parent+viewer' })).not.toThrow();
  });
});
