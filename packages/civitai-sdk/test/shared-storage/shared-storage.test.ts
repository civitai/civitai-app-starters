import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import { ApiError } from '../../src/http/index.js';
import type { SharedStorageClient } from '../../src/shared-storage/index.js';
import {
  createFakeSharedStorage,
  type FakeSharedStorage,
  type FakeSharedStorageOptions,
} from '../support/fake-shared-storage.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const BASE = 'https://civitai.com/api/v1';
const ROUTE = '/api/v1/blocks/shared-storage';

/**
 * The seam is `fetch`. Everything below drives the REAL client — its methods, its
 * URLs, its query strings, its bodies, its status handling and its date revival —
 * against a fake server.
 */
async function sharedOf(
  fake: Pick<FakeSharedStorage, 'fetch'>,
  refresh?: () => string,
): Promise<SharedStorageClient> {
  const app = await initialize({ token: 'block-jwt-1', refresh, fetch: fake.fetch });
  return app.sharedStorage;
}

const withFake = async (options: FakeSharedStorageOptions = {}) => {
  const fake = createFakeSharedStorage(options);
  return { fake, shared: await sharedOf(fake) };
};

/** A client wired to a scripted response list, for the malformed-reply guards. */
const scripted = (responses: Array<() => Response>) =>
  sharedOf({ fetch: fakeFetch(responses).fetch });

/** Pairwise distinct, and distinct from every constant an assertion names. */
const STAMPS = {
  created: new Date('2026-03-04T05:06:07.008Z'),
  updated: new Date('2026-07-08T09:10:11.012Z'),
} as const;

const ITEM = {
  key: 'k1',
  authorUserId: 77,
  value: { title: 'a' },
  count: 3,
  createdAt: STAMPS.created.toISOString(),
  updatedAt: STAMPS.updated.toISOString(),
  viewerVoted: false,
};

describe('AppClient.sharedStorage — routes and verbs', () => {
  it('🔴 sends GET for the four reads and POST for the seven writes, under the site base URL', async () => {
    const { fake, shared } = await withFake({
      seed: [{ key: 'r1', value: { title: 'x' }, authorUserId: 1 }],
      counters: { 'playcount:1': 5 },
    });

    await shared.list({ prefix: 'r' });
    await shared.get('r1');
    await shared.counts(['r1']);
    await shared.top({ prefix: 'playcount:' });
    await shared.append({ title: 'new' });
    await shared.update('r1', { title: 'edited' });
    await shared.vote('r1');
    await shared.unvote('r1');
    await shared.report('r1', 'spam');
    await shared.increment('playcount:1');
    await shared.withdraw('r1');

    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${ROUTE}/list`,
      `GET ${ROUTE}/item`,
      `GET ${ROUTE}/counts`,
      `GET ${ROUTE}/top`,
      `POST ${ROUTE}/append`,
      `POST ${ROUTE}/update`,
      `POST ${ROUTE}/vote`,
      `POST ${ROUTE}/unvote`,
      `POST ${ROUTE}/report`,
      `POST ${ROUTE}/increment`,
      `POST ${ROUTE}/withdraw`,
    ]);
  });

  it('🔴 a read sent as POST is a 405 — so the verb split is load-bearing, not cosmetic', async () => {
    // The mutation this pins: copying the per-viewer client's uniform POST. The
    // fake answers with the route's real 405, which is what makes that mutation
    // fail rather than pass silently.
    const fake = createFakeSharedStorage();
    const wrongVerb = await fake.fetch(`${BASE}/blocks/shared-storage/list`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: '{}',
    });
    expect(wrongVerb.status).toBe(405);

    // The pair: the verb the client actually uses is accepted.
    const rightVerb = await fake.fetch(`${BASE}/blocks/shared-storage/list`, {
      method: 'GET',
      headers: { Authorization: 'Bearer t' },
    });
    expect(rightVerb.status).toBe(200);
  });

  it('🔴 a write sent as GET is a 405 too — the split is enforced in both directions', async () => {
    const fake = createFakeSharedStorage();
    const wrongVerb = await fake.fetch(`${BASE}/blocks/shared-storage/vote`, {
      method: 'GET',
      headers: { Authorization: 'Bearer t' },
    });
    expect(wrongVerb.status).toBe(405);
  });

  it('carries the reads in the QUERY STRING and the writes in the BODY', async () => {
    const { fake, shared } = await withFake({
      seed: [{ key: 'r1', value: { title: 'x' }, authorUserId: 1 }],
    });

    await shared.list({ prefix: 'r', limit: 7, cursor: 'cur' });
    await shared.vote('r1');

    expect(fake.calls[0]!.query).toEqual({ prefix: ['r'], limit: ['7'], cursor: ['cur'] });
    // A GET carries no body at all — not an empty one.
    expect(fake.calls[0]!.body).toBeUndefined();
    expect(fake.calls[1]!.body).toEqual({ key: 'r1' });
    expect(fake.calls[1]!.query).toEqual({});
  });

  it('follows a `siteUrl` override, so a dev harness redirects shared storage too', async () => {
    const fake = createFakeSharedStorage();
    const urls: string[] = [];
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return fake.fetch(input, init);
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 't', siteUrl: 'http://localhost:3000/api/v1', fetch });
    await app.sharedStorage.list();

    expect(urls).toEqual(['http://localhost:3000/api/v1/blocks/shared-storage/list']);
  });
});

describe('AppClient.sharedStorage — list', () => {
  it('parses the enveloped items and revives BOTH stamps to their own millisecond', async () => {
    const shared = await scripted([() => json(200, { items: [ITEM], metadata: {} })]);

    const { items } = await shared.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe('k1');
    expect(items[0]!.authorUserId).toBe(77);
    expect(items[0]!.count).toBe(3);
    expect(items[0]!.value).toEqual({ title: 'a' });
    expect(items[0]!.viewerVoted).toBe(false);
    // 🔴 The two stamps are distinct fixtures, so a client that read one into the
    // other's field cannot pass.
    expect(items[0]!.createdAt).toBeInstanceOf(Date);
    expect(items[0]!.updatedAt).toBeInstanceOf(Date);
    expect(items[0]!.createdAt.getTime()).toBe(STAMPS.created.getTime());
    expect(items[0]!.updatedAt.getTime()).toBe(STAMPS.updated.getTime());
  });

  it('🔴 lifts `nextCursor` out of `metadata`, and omits it on the last page', async () => {
    const { fake, shared } = await withFake({
      pageSize: 2,
      seed: [
        { key: 'a', value: { title: 'a' } },
        { key: 'b', value: { title: 'b' } },
        { key: 'c', value: { title: 'c' } },
      ],
    });

    // Newest-first on the key, so DESC: c, b then a.
    const first = await shared.list();
    expect(first.items.map((i) => i.key)).toEqual(['c', 'b']);
    expect(typeof first.nextCursor).toBe('string');

    const last = await shared.list({ cursor: first.nextCursor });
    expect(last.items.map((i) => i.key)).toEqual(['a']);
    // Absence is the caller's proof the scan completed. Not `''`, not `null`.
    expect(last.nextCursor).toBeUndefined();
    expect(fake.calls[1]!.query.cursor).toEqual([first.nextCursor]);
  });

  it('🔴 a cursor nested one level deeper is NOT found at the top level', async () => {
    // The mutation this kills: reading `res.nextCursor` instead of
    // `res.metadata.nextCursor`. Both replies below are well-formed pages, so
    // only the cursor's LOCATION separates them.
    const nested = await scripted([
      () => json(200, { items: [], metadata: { nextCursor: 'deep' } }),
    ]);
    await expect(nested.list()).resolves.toMatchObject({ nextCursor: 'deep' });

    // The paired negative: a cursor at the TOP level is not the envelope's, so a
    // client reading the right place reports none.
    const flat = await scripted([() => json(200, { items: [], nextCursor: 'shallow' })]);
    const result = await flat.list();
    expect(result.nextCursor).toBeUndefined();
  });

  it('🔴 sends the cursor it was handed, so a row only on page 2 is reachable', async () => {
    const { fake, shared } = await withFake({
      pageSize: 2,
      seed: [
        { key: 'feed:c', value: { title: 'c' } },
        { key: 'feed:b', value: { title: 'b' } },
        // Reachable ONLY on page 2 of a DESC scan. A client that drops `cursor`
        // re-reads page 1 forever.
        { key: 'feed:a', value: { title: 'a' } },
      ],
    });

    const first = await shared.list({ prefix: 'feed:' });
    const second = await shared.list({ prefix: 'feed:', cursor: first.nextCursor });

    expect(second.items.map((i) => i.key)).toEqual(['feed:a']);
    // The half a client-mocking suite cannot see: what the CLIENT sent.
    expect(fake.calls[0]!.query.cursor).toBeUndefined();
    expect(fake.calls[1]!.query.cursor).toEqual([first.nextCursor]);
  });

  it('forwards `prefix` and `limit`, and sends neither when the caller gave none', async () => {
    const { fake, shared } = await withFake({
      pageSize: 2,
      seed: [
        { key: 'draft:1', value: { title: 'd' } },
        { key: 'other:1', value: { title: 'o' } },
      ],
    });

    const filtered = await shared.list({ prefix: 'draft:', limit: 5 });
    expect(filtered.items.map((i) => i.key)).toEqual(['draft:1']);
    expect(fake.calls[0]!.query).toEqual({ prefix: ['draft:'], limit: ['5'] });

    await shared.list();
    // 🔴 No default of its own — the server owns the page size.
    expect(fake.calls[1]!.query).toEqual({});
  });

  it('🔴 throws on a malformed 200 — it never manufactures an empty feed', async () => {
    const shared = await scripted([
      () => json(200, { metadata: {} }),
      () => json(200, { items: {} }),
      () => json(200, { items: [{ ...ITEM, key: 7 }] }),
      () => json(200, { items: [{ ...ITEM, authorUserId: '77' }] }),
      () => json(200, { items: [{ ...ITEM, count: null }] }),
      () => json(200, { items: [{ ...ITEM, viewerVoted: 'no' }] }),
      // `value` absent entirely — distinct from `value: null`, which is legal.
      () => json(200, { items: [{ ...ITEM, value: undefined }] }),
    ]);

    const noItems = await shared.list().catch((e: unknown) => e);
    expect(noItems).toBeInstanceOf(CivitaiError);
    expect((noItems as Error).message).toMatch(/list: reply carried no `items` array/);

    // An object is not an array — `?? []` and a loose truthiness check both fail here.
    await expect(shared.list()).rejects.toThrow(/list: reply carried no `items` array/);
    await expect(shared.list()).rejects.toThrow(/malformed item/);
    await expect(shared.list()).rejects.toThrow(/malformed item/);
    await expect(shared.list()).rejects.toThrow(/malformed item/);
    await expect(shared.list()).rejects.toThrow(/malformed item/);
    await expect(shared.list()).rejects.toThrow(/malformed item/);
  });

  it('🔴 refuses a null timestamp by its own check, not by the NaN one', async () => {
    const shared = await scripted([
      // `new Date(null)` is the EPOCH, not an Invalid Date, so the NaN check
      // cannot catch this — it needs the type gate above it.
      () => json(200, { items: [{ ...ITEM, createdAt: null }] }),
      () => json(200, { items: [{ ...ITEM, updatedAt: null }] }),
      // …and the NaN check's own case: a string that passes the type gate and
      // still yields an Invalid Date. Without it, that check is a guard no test
      // executes.
      () => json(200, { items: [{ ...ITEM, updatedAt: 'the day before yesterday' }] }),
    ]);

    await expect(shared.list()).rejects.toThrow(/malformed item timestamp/);
    await expect(shared.list()).rejects.toThrow(/malformed item timestamp/);
    await expect(shared.list()).rejects.toThrow(/malformed item timestamp/);
  });

  it('pages to exhaustion within a bound — and the pair of read counts', async () => {
    const scan = async (shared: SharedStorageClient) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      const MAX_PAGES = 20;
      do {
        const page = await shared.list({ cursor });
        for (const i of page.items) seen.push(i.key);
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor && pages < MAX_PAGES);
      return { seen, truncated: Boolean(cursor) };
    };

    // Truncated first page ⇒ exactly one EXTRA read after it.
    const multi = createFakeSharedStorage({
      pageSize: 2,
      seed: [
        { key: 'a', value: { title: 'a' } },
        { key: 'b', value: { title: 'b' } },
        { key: 'c', value: { title: 'c' } },
      ],
    });
    const many = await scan(await sharedOf(multi));
    expect(many.seen).toEqual(['c', 'b', 'a']);
    expect(many.truncated).toBe(false);
    expect(multi.calls.length - 1).toBe(1);

    // The paired zero: a first page that was not full costs no extra read.
    const single = createFakeSharedStorage({ pageSize: 2, seed: [{ key: 'a', value: { title: 'a' } }] });
    const one = await scan(await sharedOf(single));
    expect(one.seen).toEqual(['a']);
    expect(single.calls.length - 1).toBe(0);
  });
});

describe('AppClient.sharedStorage — get', () => {
  it('resolves the item, and `null` for a key with no visible row', async () => {
    const { fake, shared } = await withFake({
      seed: [{ key: 'k1', value: { title: 'here' }, authorUserId: 9 }],
    });

    const found = await shared.get('k1');
    expect(found?.key).toBe('k1');
    expect(found?.authorUserId).toBe(9);
    expect(fake.calls[0]!.query).toEqual({ key: ['k1'] });

    // 🔴 A miss is a 200 with `item: null`, and `null` is the answer — it covers
    // hidden and never-existed alike.
    await expect(shared.get('missing')).resolves.toBeNull();
  });

  it('🔴 throws on a 2xx that carried no `item` — `null` means no visible row, not unreadable', async () => {
    const shared = await scripted([() => json(200, { notItem: 1 })]);

    const error = await shared.get('k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CivitaiError);
    expect((error as Error).message).toMatch(/get: reply carried no `item`/);
  });

  it('reports `viewerVoted` for the viewer who voted, and false for one who did not', async () => {
    const voted = await withFake({
      viewer: { id: 5 },
      seed: [{ key: 'k1', value: { title: 'x' }, votes: [5] }],
    });
    await expect(voted.shared.get('k1')).resolves.toMatchObject({ viewerVoted: true, count: 1 });

    // The pair, so the flag is not simply always true.
    const notVoted = await withFake({
      viewer: { id: 6 },
      seed: [{ key: 'k1', value: { title: 'x' }, votes: [5] }],
    });
    await expect(notVoted.shared.get('k1')).resolves.toMatchObject({
      viewerVoted: false,
      count: 1,
    });
  });
});

describe('AppClient.sharedStorage — counts', () => {
  it('sends one repeated `keys` param per key and resolves the map', async () => {
    const { fake, shared } = await withFake({
      seed: [
        { key: 'a', value: { title: 'a' }, votes: [1, 2, 3] },
        { key: 'b', value: { title: 'b' }, votes: [1] },
      ],
    });

    // 🔴 Unknown keys resolve to 0, so the caller gets one entry per key asked.
    await expect(shared.counts(['a', 'b', 'nope'])).resolves.toEqual({ a: 3, b: 1, nope: 0 });
    // Repeated params, NOT a comma-joined one — a comma is legal inside a key.
    expect(fake.calls[0]!.query.keys).toEqual(['a', 'b', 'nope']);
  });

  it('🔴 does not comma-join, so a key containing a comma survives the round trip', async () => {
    const { fake, shared } = await withFake({
      seed: [
        { key: 'a,b', value: { title: 'x' }, votes: [1] },
        { key: 'c', value: { title: 'y' }, votes: [1, 2] },
      ],
    });

    // 🔴 TWO keys, one of which CONTAINS a comma — and that pairing is the whole
    // control. Measured: with a single `['a,b']` the joined and unjoined spellings
    // put the SAME bytes on the wire (`?keys=a,b`), so this guard could not see a
    // client that joined; it survived the mutation until the second key was added.
    await expect(shared.counts(['a,b', 'c'])).resolves.toEqual({ 'a,b': 1, c: 2 });
    // Two params, the first holding the comma verbatim. A client that joined would
    // send ONE param reading `a,b,c`, which no server could split back correctly.
    expect(fake.calls[0]!.query.keys).toEqual(['a,b', 'c']);
  });

  it('🔴 throws when a requested key is missing from the reply, rather than reading 0', async () => {
    // The server promises one entry per requested key. A silent 0 would render as
    // "nobody voted for this", which is a different claim from "the reply was wrong".
    const shared = await scripted([
      () => json(200, { counts: { a: 1 } }),
      () => json(200, { notCounts: {} }),
      // An array is an object — the guard must exclude it explicitly.
      () => json(200, { counts: [] }),
      () => json(200, { counts: { a: '1' } }),
    ]);

    await expect(shared.counts(['a', 'b'])).rejects.toThrow(
      /counts: reply carried no count for `b`/,
    );
    await expect(shared.counts(['a'])).rejects.toThrow(/counts: reply carried no `counts` object/);
    await expect(shared.counts(['a'])).rejects.toThrow(/counts: reply carried no `counts` object/);
    // A string count is not a number — declaring `number` must not be a cast.
    await expect(shared.counts(['a'])).rejects.toThrow(/counts: reply carried no count for `a`/);
  });
});

describe('AppClient.sharedStorage — top', () => {
  it('🔴 parses a BARE ARRAY, ranked by count descending', async () => {
    const { fake, shared } = await withFake({
      pageSize: 10,
      counters: { 'playcount:a': 2, 'playcount:b': 9, 'other:c': 100 },
    });

    const ranked = await shared.top({ prefix: 'playcount:', limit: 5 });
    expect(ranked).toEqual([
      { key: 'playcount:b', count: 9 },
      { key: 'playcount:a', count: 2 },
    ]);
    expect(fake.calls[0]!.query).toEqual({ prefix: ['playcount:'], limit: ['5'] });
  });

  it('🔴 throws when the reply is ENVELOPED rather than bare — the shape `list` uses is wrong here', async () => {
    // The exact mutation the route comment warns about: inferring `top`'s shape
    // from its neighbour `list`.
    const shared = await scripted([
      () => json(200, { items: [{ key: 'a', count: 1 }] }),
      () => json(200, { key: 'a', count: 1 }),
      () => json(200, [{ key: 'a', count: '1' }]),
      () => json(200, [{ count: 1 }]),
    ]);

    await expect(shared.top()).rejects.toThrow(/top: reply was not an array/);
    await expect(shared.top()).rejects.toThrow(/top: reply was not an array/);
    await expect(shared.top()).rejects.toThrow(/top: malformed counter/);
    await expect(shared.top()).rejects.toThrow(/top: malformed counter/);
  });

  it('sends no prefix or limit of its own when the caller gave none', async () => {
    const { fake, shared } = await withFake({ counters: { x: 1 } });
    await shared.top();
    expect(fake.calls[0]!.query).toEqual({});
  });
});

describe('AppClient.sharedStorage — append', () => {
  it('🔴 sends the value and NO key, and resolves the key the SERVER minted', async () => {
    const { fake, shared } = await withFake({ mintKeys: ['01JSERVERMINTED'] });

    await expect(shared.append({ title: 'a request', body: 'please' })).resolves.toEqual({
      key: '01JSERVERMINTED',
    });
    expect(fake.calls[0]!.body).toEqual({ value: { title: 'a request', body: 'please' } });
    // 🔴 The request carries no `key` at all — a client-chosen key would let one
    // viewer overwrite another's row.
    expect('key' in fake.calls[0]!.body!).toBe(false);
    // The row landed under the server's key, not any key the client invented.
    expect(fake.rows().map((r) => r.key)).toEqual(['01JSERVERMINTED']);
  });

  it('forwards the opaque `data` blob alongside the moderated text', async () => {
    const { fake, shared } = await withFake();
    await shared.append({ title: 't', data: { deck: [1, 2, 3] } });
    expect(fake.calls[0]!.body).toEqual({ value: { title: 't', data: { deck: [1, 2, 3] } } });
  });

  it('throws when the reply carried no `key`, rather than declaring a string it never saw', async () => {
    const shared = await scripted([() => json(200, { ok: true })]);
    await expect(shared.append({ title: 't' })).rejects.toThrow(
      /append: reply carried no `key`/,
    );
  });

  it('🔴 a refused write rejects as a public ApiError carrying its status', async () => {
    const { shared } = await withFake({
      refuse: [{ status: 429, body: { message: 'daily append limit reached' } }],
    });

    const error = await shared.append({ title: 't' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).message).toBe('daily append limit reached');
    // Positive control on the discriminator: a different refusal is a different
    // status, so the check above is not simply always true.
    expect(new ApiError(403, 'no', {}).status).not.toBe(429);
  });
});

describe('AppClient.sharedStorage — update', () => {
  it('sends both the key and the new value, and replaces the stored value', async () => {
    const { fake, shared } = await withFake({
      viewer: { id: 3 },
      seed: [{ key: 'k1', value: { title: 'before' }, authorUserId: 3 }],
    });

    await expect(shared.update('k1', { title: 'after' })).resolves.toEqual({ ok: true });
    expect(fake.calls[0]!.body).toEqual({ key: 'k1', value: { title: 'after' } });
    expect(fake.rows().map((r) => r.value)).toEqual([{ title: 'after' }]);
  });

  it("🔴 rejects on another author's row — a 403, never a silent no-op", async () => {
    const { shared } = await withFake({
      viewer: { id: 3 },
      seed: [{ key: 'k1', value: { title: 'theirs' }, authorUserId: 999 }],
    });

    await expect(shared.update('k1', { title: 'mine now' })).rejects.toMatchObject({ status: 403 });
    // …and a missing row is a 404, a different refusal from the ownership one.
    await expect(shared.update('nope', { title: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('AppClient.sharedStorage — vote and unvote', () => {
  it('resolves the new tally, and a second vote does not inflate it', async () => {
    const { fake, shared } = await withFake({
      viewer: { id: 4 },
      seed: [{ key: 'k1', value: { title: 'x' }, votes: [8] }],
    });

    await expect(shared.vote('k1')).resolves.toEqual({ count: 2 });
    // 🔴 Idempotent: the same viewer voting twice resolves the UNCHANGED count.
    await expect(shared.vote('k1')).resolves.toEqual({ count: 2 });
    expect(fake.calls[0]!.body).toEqual({ key: 'k1' });
    expect(fake.votesFor('k1').sort()).toEqual([4, 8]);
  });

  it('unvote removes only this viewer’s vote, and never goes negative', async () => {
    const { shared } = await withFake({
      viewer: { id: 4 },
      seed: [{ key: 'k1', value: { title: 'x' }, votes: [4, 8] }],
    });

    await expect(shared.unvote('k1')).resolves.toEqual({ count: 1 });
    // A second unvote is a no-op, not a negative tally.
    await expect(shared.unvote('k1')).resolves.toEqual({ count: 1 });
  });

  it('🔴 throws when either reply carried no `count` — a rendered tally is never invented', async () => {
    // `?? 0` here would read to the viewer as "your vote did not land" for a vote
    // that did.
    const shared = await scripted([
      () => json(200, { ok: true }),
      () => json(200, { count: '2' }),
      () => json(200, { ok: true }),
    ]);

    await expect(shared.vote('k')).rejects.toThrow(/vote: reply carried no `count`/);
    await expect(shared.vote('k')).rejects.toThrow(/vote: reply carried no `count`/);
    // 🔴 The message names the OP, so `unvote` cannot be satisfied by `vote`'s
    // error — a shared helper that hardcoded one name would fail here.
    await expect(shared.unvote('k')).rejects.toThrow(/unvote: reply carried no `count`/);
  });

  it('a vote on a hidden or missing row rejects 404 rather than resolving 0', async () => {
    const { shared } = await withFake({ seed: [] });
    await expect(shared.vote('gone')).rejects.toMatchObject({ status: 404 });
  });
});

describe('AppClient.sharedStorage — withdraw', () => {
  it('reports `deleted: true` for the author’s own row', async () => {
    const { fake, shared } = await withFake({
      viewer: { id: 3 },
      seed: [{ key: 'k1', value: { title: 'x' }, authorUserId: 3 }],
    });

    await expect(shared.withdraw('k1')).resolves.toEqual({ ok: true, deleted: true });
    expect(fake.calls[0]!.body).toEqual({ key: 'k1' });
    expect(fake.rows()).toEqual([]);
  });

  it('🔴 reports `deleted: false` — a SUCCESS — identically for a foreign key and a missing one', async () => {
    const { shared } = await withFake({
      viewer: { id: 3 },
      seed: [{ key: 'theirs', value: { title: 'x' }, authorUserId: 999 }],
    });

    // Indistinguishable on purpose: this must not become an existence oracle.
    await expect(shared.withdraw('theirs')).resolves.toEqual({ ok: true, deleted: false });
    await expect(shared.withdraw('never-existed')).resolves.toEqual({ ok: true, deleted: false });
  });

  it('throws when the reply carried no `deleted` flag', async () => {
    const shared = await scripted([() => json(200, { ok: true })]);
    await expect(shared.withdraw('k')).rejects.toThrow(
      /withdraw: reply carried no `deleted` flag/,
    );
  });
});

describe('AppClient.sharedStorage — report', () => {
  it('sends the key and the reason, and omits `reason` when none was given', async () => {
    const { fake, shared } = await withFake({
      seed: [{ key: 'k1', value: { title: 'x' } }],
    });

    await expect(shared.report('k1', 'spam')).resolves.toEqual({ ok: true });
    expect(fake.calls[0]!.body).toEqual({ key: 'k1', reason: 'spam' });

    await shared.report('k1');
    // 🔴 Omitted, not sent as null — the server applies its own default.
    expect(fake.calls[1]!.body).toEqual({ key: 'k1' });
    expect('reason' in fake.calls[1]!.body!).toBe(false);
  });

  it('resolves identically for a deduped repeat, so it cannot reveal who reported what', async () => {
    const { fake, shared } = await withFake({ seed: [{ key: 'k1', value: { title: 'x' } }] });

    await expect(shared.report('k1', 'first')).resolves.toEqual({ ok: true });
    await expect(shared.report('k1', 'again')).resolves.toEqual({ ok: true });
    // One row filed, two identical answers.
    expect(fake.reports()).toHaveLength(1);
  });
});

describe('AppClient.sharedStorage — increment', () => {
  it('bumps the counter and resolves its new value', async () => {
    const { fake, shared } = await withFake({ counters: { 'playcount:7': 41 } });

    await expect(shared.increment('playcount:7')).resolves.toEqual({
      key: 'playcount:7',
      count: 42,
    });
    expect(fake.calls[0]!.body).toEqual({ key: 'playcount:7' });
    expect(fake.counters()['playcount:7']).toBe(42);
  });

  it('creates a counter on first use', async () => {
    const { shared } = await withFake();
    await expect(shared.increment('playcount:new')).resolves.toEqual({
      key: 'playcount:new',
      count: 1,
    });
  });

  it('🔴 throws when the reply carried no `count`, and falls back to the sent key only for the key', async () => {
    const noCount = await scripted([() => json(200, { key: 'k' })]);
    await expect(noCount.increment('k')).rejects.toThrow(
      /increment: reply carried no `count`/,
    );

    // The key is the recoverable half: the caller already knows what it sent.
    const noKey = await scripted([() => json(200, { count: 5 })]);
    await expect(noKey.increment('mine')).resolves.toEqual({ key: 'mine', count: 5 });
  });

  it('🔴 prefers the server’s echoed key over the one it sent', async () => {
    // A fixture whose two keys are distinct, so "echoes" and "falls back" are
    // distinguishable — the control the fallback needs.
    const shared = await scripted([() => json(200, { key: 'server-said', count: 1 })]);
    await expect(shared.increment('client-sent')).resolves.toEqual({
      key: 'server-said',
      count: 1,
    });
  });
});

describe('AppClient.sharedStorage — an anonymous viewer reads but never writes', () => {
  it('🔴 SERVES the four reads to an anonymous viewer — unlike per-viewer storage', async () => {
    const { shared } = await withFake({
      viewer: null,
      pageSize: 10,
      counters: { 'playcount:a': 3 },
      seed: [{ key: 'k1', value: { title: 'public' }, votes: [9] }],
    });

    // The whole point of this surface: signed-out browsing works.
    await expect(shared.list()).resolves.toMatchObject({ items: [{ key: 'k1' }] });
    await expect(shared.get('k1')).resolves.toMatchObject({ key: 'k1' });
    await expect(shared.counts(['k1'])).resolves.toEqual({ k1: 1 });
    await expect(shared.top()).resolves.toEqual([{ key: 'playcount:a', count: 3 }]);
  });

  it('🔴 `viewerVoted` is false for an anonymous viewer — not evidence nobody voted', async () => {
    const { shared } = await withFake({
      viewer: null,
      seed: [{ key: 'k1', value: { title: 'x' }, votes: [9, 10] }],
    });

    const item = await shared.get('k1');
    expect(item?.viewerVoted).toBe(false);
    // …while the aggregate still shows the votes that exist. A caller must not
    // read the false flag as an empty tally.
    expect(item?.count).toBe(2);
  });

  it('🔴 refuses every write with a 403 — the scope binding, not the handler’s 401', async () => {
    const { shared } = await withFake({
      viewer: null,
      seed: [{ key: 'k1', value: { title: 'x' } }],
    });

    for (const attempt of [
      shared.append({ title: 't' }),
      shared.update('k1', { title: 't' }),
      shared.vote('k1'),
      shared.unvote('k1'),
      shared.withdraw('k1'),
      shared.report('k1'),
      shared.increment('c'),
    ]) {
      await expect(attempt).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('AppClient.sharedStorage — a signed-in viewer below the trust gate', () => {
  it('🔴 reads fine and is refused 403 on a write — signed in is not permitted to write', async () => {
    const { shared } = await withFake({
      trusted: false,
      pageSize: 10,
      seed: [{ key: 'k1', value: { title: 'x' } }],
    });

    // Positive control: the same fixture reads a NON-EMPTY page, so the refusal
    // below is the trust gate and not a fake wired to nothing.
    await expect(shared.list()).resolves.toMatchObject({ items: [{ key: 'k1' }] });

    const error = await shared.vote('k1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).message).toMatch(/minimum trust/);
  });
});

describe('AppClient.sharedStorage — token refresh', () => {
  it('retries a 401 exactly once, with a different bearer', async () => {
    const fake = createFakeSharedStorage({
      pageSize: 10,
      seed: [{ key: 'k1', value: { title: 'x' } }],
      refuse: [{ status: 401, body: { message: 'invalid block token' } }],
    });
    const shared = await sharedOf(fake, () => 'block-jwt-2');

    await expect(shared.list()).resolves.toMatchObject({ items: [{ key: 'k1' }] });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.map((c) => c.token)).toEqual(['block-jwt-1', 'block-jwt-2']);
  });

  it('gives up after the fresh token is refused too — it does not retry twice', async () => {
    const fake = createFakeSharedStorage({
      refuse: [
        { status: 401, body: { message: 'invalid block token' } },
        { status: 401, body: { message: 'invalid block token' } },
        { status: 401, body: { message: 'invalid block token' } },
      ],
    });
    const shared = await sharedOf(fake, () => 'block-jwt-2');

    await expect(shared.list()).rejects.toMatchObject({ status: 401 });
    expect(fake.calls).toHaveLength(2);
  });
});

describe('AppClient.sharedStorage — refusal bodies', () => {
  it('🔴 reads the reason from `error` as well as `message` — middleware sends only `error`', async () => {
    // BREAKING.md: a middleware rejection carries NO `message` at all, so a
    // client reading only `message` logs `undefined` for the refusals that matter
    // most. Both shapes must surface a real sentence.
    const onlyError = await scripted([
      () => json(403, { error: 'apps:storage:shared:write requires authenticated subject' }),
    ]);
    await expect(onlyError.vote('k')).rejects.toThrow(/requires authenticated subject/);

    const onlyMessage = await scripted([() => json(404, { message: 'not found' })]);
    await expect(onlyMessage.vote('k')).rejects.toThrow(/not found/);
  });
});

describe('AppClient.sharedStorage — abort', () => {
  it('passes the caller’s signal down to fetch, on a GET read and a POST write alike', async () => {
    // Models `fetch`: an already-aborted signal rejects at once, and one that
    // aborts later rejects then. The client reaches this only after awaiting the
    // token, so which arm fires is a timing detail the test must not depend on.
    const hang = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      if (init.signal?.aborted) throw init.signal.reason;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      });
    }) as typeof globalThis.fetch;

    const readShared = await sharedOf({ fetch: hang });
    const readController = new AbortController();
    const reading = readShared.list({}, { signal: readController.signal });
    readController.abort(new Error('reader went away'));
    await expect(reading).rejects.toThrow('reader went away');

    const writeShared = await sharedOf({ fetch: hang });
    const writeController = new AbortController();
    const writing = writeShared.vote('k', { signal: writeController.signal });
    writeController.abort(new Error('writer went away'));
    await expect(writing).rejects.toThrow('writer went away');
  });
});

describe('the fake itself', () => {
  it('🔴 puts ISO STRINGS on the wire, which is what makes the revival observable', async () => {
    const fake = createFakeSharedStorage({
      seed: [
        {
          key: 'a',
          value: { title: 'x' },
          createdAt: STAMPS.created,
          updatedAt: STAMPS.updated,
        },
      ],
    });
    const raw = await fake.fetch(`${BASE}/blocks/shared-storage/list`, {
      method: 'GET',
      headers: { Authorization: 'Bearer t' },
    });
    const wire = (await raw.json()) as {
      items: { createdAt: unknown; updatedAt: unknown }[];
    };

    expect(typeof wire.items[0]!.createdAt).toBe('string');
    expect(typeof wire.items[0]!.updatedAt).toBe('string');
    expect(wire.items[0]!.createdAt).toBe(STAMPS.created.toISOString());

    // The pair, and the reason the rule exists: had the wire carried a `Date`,
    // reviving it would be a no-op, so deleting `new Date(...)` in the client
    // would survive a fully green suite. This is that no-op, asserted.
    expect(new Date(STAMPS.created).getTime()).toBe(STAMPS.created.getTime());
  });

  it('gives seeded rows pairwise-distinct, and never equal, stamps', async () => {
    const fake = createFakeSharedStorage({
      seed: [
        { key: 'a', value: { title: 'a' } },
        { key: 'b', value: { title: 'b' } },
        { key: 'c', value: { title: 'c' } },
      ],
    });
    const rows = fake.rows();
    const created = rows.map((r) => r.createdAt.getTime());
    expect(new Set(created).size).toBe(created.length);
    // 🔴 `createdAt !== updatedAt` on every row, so a client that read one into
    // the other's field cannot pass.
    for (const row of rows) {
      expect(row.createdAt.getTime()).not.toBe(row.updatedAt.getTime());
    }
  });

  it('refuses a route it does not serve, so a wrong path cannot look like a refusal', async () => {
    const fake = createFakeSharedStorage();
    await expect(
      fake.fetch(`${BASE}/blocks/shared_storage/list`, { method: 'GET' }),
    ).rejects.toThrow(/no route for/);
    await expect(
      fake.fetch(`${BASE}/blocks/shared-storage/quota`, { method: 'GET' }),
    ).rejects.toThrow(/no route for/);
  });
});
