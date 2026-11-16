import { describe, expect, it } from 'vitest';

import { StorageError, type StoragePublishResult } from '../../src/doc-store/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';

/**
 * `collection(to).publish({ from, keys, prune? })` and `.unpublish(keys)`: the
 * real client over the fake, which ports the server's server-side publish (civitai/civitai,
 * `runPublish` / `publishCopies` in `doc-store-api.ts` / `doc-store.ts`). Not contract-pinned:
 * the server's routes sit behind a per-app flag, so the contract describes them in
 * `conventions.publish` and runs no case.
 */

const SCOPES = ['apps:storage', 'apps:storage:publish'];
const COLLECTIONS = {
  drafts: { visibility: 'private' },
  notes: { visibility: 'private' },
  clips: { visibility: 'shared', write: 'own', indexes: { char: 'string' }, showAuthor: true },
  plays: { visibility: 'shared', write: 'none', counters: ['plays'] },
};
const ALICE = { username: 'alice', id: 910_101 };
const BOB = { username: 'bob', id: 910_102 };

function make(extra: Partial<FakeStorageOptions> = {}) {
  let t = Date.parse('2031-01-01T00:00:00.000Z');
  const fake = createFakeStorage({
    manifest: { scopes: SCOPES, storage: { collections: COLLECTIONS } },
    viewer: ALICE,
    now: () => t,
    // Off by default, as on civitai.com; these tests exercise the publish path.
    publish: true,
    ...extra,
  });
  const alice = fake.storage;
  const bob = fake.as({ viewer: BOB }).storage;
  return { fake, alice, bob, advance: (ms: number) => (t += ms) };
}

const result = (r: Partial<StoragePublishResult>): StoragePublishResult => ({
  created: [],
  updated: [],
  unchanged: [],
  pruned: [],
  skipped: [],
  pruneIncomplete: false,
  ...r,
});

async function refusal(p: Promise<unknown>): Promise<StorageError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(StorageError);
    return err as StorageError;
  }
  throw new Error('expected a refusal');
}

describe('publish', () => {
  it("copies the viewer's own private documents as their shared documents", async () => {
    const { alice, bob } = make();
    await alice.collection('drafts').put('c2', { char: 'A', n: 2 });
    await alice.collection('drafts').put('c1', { char: 'A', n: 1 });
    const r = await alice.collection('clips').publish({ from: 'drafts', keys: ['c2', 'c1'] });
    expect(r).toEqual(result({ created: ['c1', 'c2'] }));
    const seen = await bob.collection('clips').get('c1');
    expect(seen).toMatchObject({ data: { char: 'A', n: 1 }, author: { kind: 'user', isViewer: false, username: 'alice' } });
  });

  it('re-publish writes only new or changed documents', async () => {
    const { alice } = make();
    const drafts = alice.collection('drafts');
    for (const k of ['r1', 'r2', 'r3']) await drafts.put(k, { k });
    await alice.collection('clips').publish({ from: 'drafts', keys: ['r1', 'r2', 'r3'] });
    await drafts.put('r2', { k: 'r2', edited: true });
    await drafts.put('r4', { k: 'r4' });
    const r = await alice.collection('clips').publish({ from: 'drafts', keys: ['r1', 'r2', 'r3', 'r4'] });
    expect(r).toEqual(result({ created: ['r4'], updated: ['r2'], unchanged: ['r1', 'r3'] }));
    expect((await alice.collection('clips').get('r1'))?.version).toBe(1);
    expect((await alice.collection('clips').get('r2'))?.version).toBe(2);
  });

  it("never reads another viewer's private documents, and skips another viewer's copy", async () => {
    const { alice, bob } = make();
    await bob.collection('drafts').put('theirs', { secret: 'bob' });
    await bob.collection('drafts').put('taken', { by: 'bob' });
    await bob.collection('clips').publish({ from: 'drafts', keys: ['taken'] });
    await alice.collection('drafts').put('taken', { by: 'alice' });
    const r = await alice.collection('clips').publish({ from: 'drafts', keys: ['taken', 'theirs'] });
    expect(r).toEqual(
      result({
        skipped: [
          { key: 'taken', reason: 'not_author' },
          { key: 'theirs', reason: 'missing' },
        ],
      }),
    );
    expect((await alice.collection('clips').get('taken'))?.data).toEqual({ by: 'bob' });
    expect(await alice.collection('clips').get('theirs')).toBeNull();
  });

  it("prune deletes the viewer's own copies whose private document is gone, and leaves another character's", async () => {
    const { alice, bob } = make();
    const drafts = alice.collection('drafts');
    const clips = alice.collection('clips');
    for (const k of ['A:1', 'A:2', 'B:1', 'B:2']) await drafts.put(k, { char: k[0] });
    await clips.publish({ from: 'drafts', keys: ['A:1', 'A:2'] });
    await clips.publish({ from: 'drafts', keys: ['B:1', 'B:2'] });
    await bob.collection('drafts').put('A:9', { by: 'bob' });
    await bob.collection('clips').publish({ from: 'drafts', keys: ['A:9'] });
    await drafts.delete('A:2');

    const r = await clips.publish({ from: 'drafts', keys: ['A:1'], prune: true });
    expect(r).toEqual(result({ unchanged: ['A:1'], pruned: ['A:2'] }));
    const page = await clips.list();
    expect(page.items.map((d) => d.key)).toEqual(['A:1', 'A:9', 'B:1', 'B:2']);
  });

  it("prune is scoped by `from`: it deletes the viewer's copies published from another private collection", async () => {
    const { alice } = make();
    await alice.collection('drafts').put('d1', { src: 'drafts' });
    await alice.collection('notes').put('n1', { src: 'notes' });
    const clips = alice.collection('clips');
    await clips.publish({ from: 'drafts', keys: ['d1'] });
    await clips.publish({ from: 'notes', keys: ['n1'] });
    const r = await clips.publish({ from: 'drafts', keys: ['d1'], prune: true });
    expect(r).toEqual(result({ unchanged: ['d1'], pruned: ['n1'] }));
    expect((await clips.list()).items.map((d) => d.key)).toEqual(['d1']);
  });

  it('refuses no keys, too many and a duplicate before sending anything the server would spend', async () => {
    const { alice } = make();
    const clips = alice.collection('clips');
    expect((await refusal(clips.publish({ from: 'drafts', keys: [] }))).details).toMatchObject({ reason: 'empty_keys' });
    const over = Array.from({ length: 501 }, (_, i) => `k${i}`);
    expect((await refusal(clips.publish({ from: 'drafts', keys: over }))).details).toMatchObject({
      reason: 'too_many_keys',
      max: 500,
    });
    expect((await refusal(clips.publish({ from: 'drafts', keys: ['a', 'a'] }))).details).toMatchObject({
      reason: 'duplicate_key',
      key: 'a',
    });
  });

  it('a moderation hit refuses the whole publish, naming the key', async () => {
    const { alice } = make();
    await alice.collection('drafts').put('ok', { t: 'fine' });
    await alice.collection('drafts').put('bad', { t: 'contract-blocked-term' });
    const err = await refusal(alice.collection('clips').publish({ from: 'drafts', keys: ['bad', 'ok'] }));
    expect([err.status, err.code, err.details]).toEqual([422, 'content_rejected', { category: 'blocked', key: 'bad' }]);
    expect(await alice.collection('clips').get('ok')).toBeNull();
  });

  it('a publish the document cap cannot hold is refused whole', async () => {
    const { alice } = make({ limits: { viewerDocs: 5 } });
    for (const k of ['q1', 'q2', 'q3']) await alice.collection('drafts').put(k, { k });
    const err = await refusal(alice.collection('clips').publish({ from: 'drafts', keys: ['q1', 'q2', 'q3'] }));
    expect([err.status, err.code, err.details]).toEqual([413, 'quota_exceeded', { ceiling: 'author' }]);
    expect((await alice.info()).usage.viewer.docs).toBe(3);
  });

  it('spends its own budget, not the shared write budget, and surfaces retryAfter on the 429', async () => {
    const { alice } = make({ enforceRateLimits: true });
    for (let i = 0; i < 10; i++) {
      await alice.collection('drafts').put(`b${i}`, { i });
      await alice.collection('clips').publish({ from: 'drafts', keys: [`b${i}`] });
    }
    await alice.collection('drafts').put('b10', { i: 10 });
    const err = await refusal(alice.collection('clips').publish({ from: 'drafts', keys: ['b10'] }));
    expect([err.status, err.code, err.details?.bucket, err.retryAfter]).toEqual([429, 'rate_limited', 'publish', 8640]);
    // The shared write budget (burst 30) is untouched: 30 ad-hoc shared writes still land.
    for (let i = 0; i < 30; i++) await alice.collection('clips').put(`adhoc${i}`, { i });
  });

  it('refuses a private target and a shared source', async () => {
    const { alice } = make();
    for (const [to, from] of [
      ['notes', 'drafts'],
      ['clips', 'clips'],
    ] as const) {
      const err = await refusal(alice.collection(to).publish({ from, keys: ['a'] }));
      expect([err.code, err.details?.reason]).toEqual(['invalid_request', 'publish_visibility']);
    }
  });

  it('refuses a collection opened through an import, before sending', async () => {
    const { alice, fake } = make();
    const before = fake.calls.length;
    const err = await refusal(alice.collection('clips', { from: 'some-app' }).publish({ from: 'drafts', keys: ['a'] }));
    expect(err.code).toBe('invalid_request');
    expect(fake.calls.length).toBe(before);
  });
});

describe('unpublish', () => {
  it("deletes only the viewer's own copies", async () => {
    const { alice, bob } = make();
    for (const k of ['x1', 'x2']) await alice.collection('drafts').put(k, { k });
    await alice.collection('clips').publish({ from: 'drafts', keys: ['x1', 'x2'] });
    await bob.collection('drafts').put('theirs', { by: 'bob' });
    await bob.collection('clips').publish({ from: 'drafts', keys: ['theirs'] });
    const r = await alice.collection('clips').unpublish(['x1', 'theirs', 'ghost']);
    expect(r).toEqual({
      deleted: ['x1'],
      skipped: [
        { key: 'ghost', reason: 'missing' },
        { key: 'theirs', reason: 'not_author' },
      ],
    });
    expect((await bob.collection('clips').get('theirs'))?.data).toEqual({ by: 'bob' });
  });
});

describe('a host that does not serve publish (the fake by default, as civitai.com with the flag off)', () => {
  it('answers 404 not_found on the wire, which the client reports as publish_unavailable', async () => {
    const fake = createFakeStorage({ manifest: { scopes: SCOPES, storage: { collections: COLLECTIONS } }, viewer: ALICE });
    const alice = fake.storage;
    await alice.collection('drafts').put('k', { k: 1 });
    for (const p of [
      alice.collection('clips').publish({ from: 'drafts', keys: ['k'] }),
      alice.collection('clips').unpublish(['k']),
    ]) {
      const err = await refusal(p);
      expect([err.status, err.code]).toEqual([404, 'publish_unavailable']);
      expect(fake.calls.at(-1)?.response).toMatchObject({ code: 'not_found', message: 'no such storage route' });
    }
  });
});
