import { describe, expect, expectTypeOf, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import {
  createDocumentStorage,
  StorageError,
  storageUpdateRefusal,
  type StorageCollection,
  type StorageUpdateOp,
  type StorageUpdateRefusalReason,
} from '../../src/doc-store/index.js';
import { ApiError, type Http, type RequestOptions } from '../../src/http/index.js';
import * as root from '../../src/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';
import { fakeFetch, json, type FetchCall } from '../support/fake-fetch.js';

/**
 * Tallies as update operators (civitai/civitai#8292): `PATCH /api/v1/blocks/storage/:c/:key`
 * with exactly one of `{"$inc":{"<counter>":by}}`, `{"$mark":"<name>"}`, `{"$unmark":"<name>"}`.
 *
 * - `update(key, op)` sends the operator as written and reads the reply its operator gives.
 * - `increment`/`mark`/`unmark` are deprecated and send the SAME PATCH (never the per-tally
 *   routes), with their replies unchanged and `by` defaulting to 1 in the client.
 * - The fake (and so the local preview, which is the fake) refuses a body that is not one
 *   operator with the server's `details.reason`, before sign-in, any budget or the
 *   collection is looked at — `parseTallyPatch` runs before `run` on the server.
 *
 * The contract's two PATCH cases also run through `contract.test.ts`; these pin what that
 * table does not: the exact wire bytes through the real fetch layer, the `details` beside
 * each reason, the check order, and the types.
 */

const SCOPES = ['apps:storage', 'apps:storage:publish'];
const COLLECTIONS = {
  posts: { visibility: 'shared', write: 'own', marks: ['vote'], counters: ['views'] },
  plays: { visibility: 'shared', write: 'none', counters: ['plays'] },
  prefs: { visibility: 'private' },
};

function make(extra: Partial<FakeStorageOptions> = {}) {
  return createFakeStorage({
    manifest: { scopes: SCOPES, storage: { collections: COLLECTIONS } },
    viewer: { username: 'alice', id: 913_007 },
    ...extra,
  });
}

/** An `Http` that records what the client sent and answers from a script. */
function recorder(answer: (method: string, path: string, opts: RequestOptions) => unknown = () => ({})) {
  const sent: { method: string; path: string; opts: RequestOptions }[] = [];
  const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
    sent.push({ method, path, opts });
    const out = answer(method, path, opts);
    if (out instanceof Error) throw out;
    return out;
  }) as Http;
  return { sent, storage: createDocumentStorage(http) };
}

const refusal = async (p: Promise<unknown>): Promise<StorageError> => {
  const outcome = await p.then(
    () => new Error('expected a refusal'),
    (e: unknown) => e,
  );
  expect(outcome).toBeInstanceOf(StorageError);
  return outcome as StorageError;
};

/** The client over the REAL http layer, against a scripted fetch. */
async function overFetch(reply: unknown) {
  const { fetch, calls } = fakeFetch([() => json(200, reply)]);
  const app = await initialize({ token: 'tok', fetch });
  return { app, calls };
}

const wire = (c: FetchCall) => ({ method: c.method, url: c.url, body: c.body });

describe('update: each operator through the real client and http layer', () => {
  it('$inc: PATCH on the document, the operator as the JSON body, `{ value }` read back', async () => {
    const { app, calls } = await overFetch({ value: 41 });
    const result = await app.storage.collection('plays').update('model-123', { $inc: { plays: 3 } });
    expect(calls.map(wire)).toEqual([
      { method: 'PATCH', url: 'https://civitai.com/api/v1/blocks/storage/plays/model-123', body: '{"$inc":{"plays":3}}' },
    ]);
    expect(result).toEqual({ value: 41 });
    expectTypeOf(result).toEqualTypeOf<{ value: number }>();
  });

  it('$mark: `{ marked: true, count }` read back; `count` absent for report', async () => {
    const vote = await overFetch({ marked: true, count: 6 });
    const voted = await vote.app.storage.collection('posts').update('p:1', { $mark: 'vote' });
    expect(vote.calls.map(wire)).toEqual([
      { method: 'PATCH', url: 'https://civitai.com/api/v1/blocks/storage/posts/p%3A1', body: '{"$mark":"vote"}' },
    ]);
    expect(voted).toEqual({ marked: true, count: 6 });
    expectTypeOf(voted).toEqualTypeOf<{ marked: true; count?: number }>();

    const report = await overFetch({ marked: true });
    expect(await report.app.storage.collection('posts').update('p:1', { $mark: 'report' })).toEqual({ marked: true });
    expect(report.calls[0]!.body).toBe('{"$mark":"report"}');
  });

  it('$unmark: `{ marked: false, count }` read back', async () => {
    const { app, calls } = await overFetch({ marked: false, count: 5 });
    const result = await app.storage.collection('posts').update('p1', { $unmark: 'vote' });
    expect(calls.map(wire)).toEqual([
      { method: 'PATCH', url: 'https://civitai.com/api/v1/blocks/storage/posts/p1', body: '{"$unmark":"vote"}' },
    ]);
    expect(result).toEqual({ marked: false, count: 5 });
    expectTypeOf(result).toEqualTypeOf<{ marked: false; count?: number }>();
  });

  it('through an import: the same PATCH with ?from=', async () => {
    const { app, calls } = await overFetch({ value: 2 });
    await app.storage.collection('board', { from: 'parent-app' }).update('b1', { $inc: { views: 2 } });
    expect(calls.map(wire)).toEqual([
      {
        method: 'PATCH',
        url: 'https://civitai.com/api/v1/blocks/storage/board/b1?from=parent-app',
        body: '{"$inc":{"views":2}}',
      },
    ]);
  });

  it('an operator held in a variable picks its reply at run time', async () => {
    const r = recorder((_m, _p, opts) => ('$inc' in (opts.body as object) ? { value: 9 } : { marked: true, count: 1 }));
    const ops: StorageUpdateOp[] = [{ $inc: { views: 1 } }, { $mark: 'vote' }];
    const posts = r.storage.collection('posts');
    const out = await Promise.all(ops.map((op) => posts.update('p', op)));
    expect(out).toEqual([{ value: 9 }, { marked: true, count: 1 }]);
    expectTypeOf(out[0]!).toEqualTypeOf<{ value: number } | { marked: boolean; count?: number }>();
  });

  it.each([
    ['$inc with no value', { $inc: { views: 1 } }, { marked: true }, /update: reply carried no `value`/],
    ['$mark answered marked: false', { $mark: 'vote' }, { marked: false, count: 1 }, /update: malformed reply/],
    ['$unmark answered marked: true', { $unmark: 'vote' }, { marked: true, count: 1 }, /update: malformed reply/],
    ['a non-numeric count', { $mark: 'vote' }, { marked: true, count: '1' }, /update: malformed reply/],
  ] as const)('a malformed 200 (%s) rejects with a CivitaiError', async (_why, op, reply, message) => {
    const r = recorder(() => reply);
    const error = await r.storage.collection('posts').update('p', op as StorageUpdateOp).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CivitaiError);
    expect(error).not.toBeInstanceOf(StorageError);
    expect((error as Error).message).toMatch(message);
  });

  it('a body that is not one operator is sent as written; the server refuses it', async () => {
    const r = recorder(() =>
      new ApiError(400, 'PATCH takes exactly one update operator', {
        code: 'invalid_request',
        message: 'PATCH takes exactly one update operator',
        error: 'PATCH takes exactly one update operator',
        details: { reason: 'multiple_operators', operators: ['$inc', '$mark'] },
      }),
    );
    const two = { $inc: { views: 1 }, $mark: 'vote' } as unknown as StorageUpdateOp;
    const error = await refusal(r.storage.collection('posts').update('p', two));
    expect(r.sent.map((s) => [s.method, s.path, s.opts.body])).toEqual([['PATCH', 'blocks/storage/posts/p', two]]);
    expect(storageUpdateRefusal(error)).toBe('multiple_operators');
  });
});

describe('the deprecated methods send the PATCH update sends', () => {
  const answer = (_method: string, _path: string, opts: RequestOptions) => {
    const op = opts.body as Record<string, unknown>;
    if ('$inc' in op) return { value: 7 };
    if (op.$mark === 'report') return { marked: true };
    return '$mark' in op ? { marked: true, count: 2 } : { marked: false, count: 1 };
  };

  it('deprecated increment sends PATCH to the document, never POST …/counters/:name', async () => {
    const r = recorder(answer);
    expect(await r.storage.collection('posts').increment('p1', 'views', 2)).toEqual({ value: 7 });
    expect(r.sent.map((s) => [s.method, s.path, s.opts.body])).toEqual([
      ['PATCH', 'blocks/storage/posts/p1', { $inc: { views: 2 } }],
    ]);
  });

  it('deprecated increment without `by` sends `by: 1` and tallies one per call', async () => {
    // Against the fake, so the default is checked by what it DOES (a total of 2), not
    // only by the bytes: a dropped default sends `{"$inc":{}}`, which is refused.
    const fake = make();
    const plays = fake.storage.collection('plays');
    expect(await plays.increment('m', 'plays')).toEqual({ value: 1 });
    expect(await plays.increment('m', 'plays')).toEqual({ value: 2 });
    expect(fake.calls.map((c) => JSON.stringify(c.body))).toEqual(['{"$inc":{"plays":1}}', '{"$inc":{"plays":1}}']);
  });

  it('deprecated mark and unmark send PATCH $mark / $unmark; replies unchanged', async () => {
    const r = recorder(answer);
    const posts = r.storage.collection('posts');
    expect(await posts.mark('p1', 'vote')).toEqual({ marked: true, count: 2 });
    expect(await posts.mark('p1', 'report')).toEqual({ marked: true });
    expect(await posts.unmark('p1', 'vote')).toEqual({ marked: false, count: 1 });
    expect(r.sent.map((s) => [s.method, s.path, s.opts.body])).toEqual([
      ['PATCH', 'blocks/storage/posts/p1', { $mark: 'vote' }],
      ['PATCH', 'blocks/storage/posts/p1', { $mark: 'report' }],
      ['PATCH', 'blocks/storage/posts/p1', { $unmark: 'vote' }],
    ]);
  });

  it('their reply checks and messages are unchanged', async () => {
    const r = recorder(() => ({ marked: true, count: 4 }));
    const posts = r.storage.collection('posts');
    await expect(posts.increment('p1', 'views')).rejects.toThrow('storage posts.increment: reply carried no `value`');
    await expect(posts.unmark('p1', 'vote')).rejects.toThrow('storage posts.unmark: malformed reply');
  });

  it('none of the four ever addresses a per-tally route, against the fake', async () => {
    const fake = make();
    const posts = fake.storage.collection('posts');
    await posts.put('p', { t: 1 });
    await posts.increment('p', 'views', 3);
    await posts.mark('p', 'vote');
    await posts.unmark('p', 'vote');
    await posts.update('p', { $inc: { views: 1 } });
    const tallies = fake.calls.slice(1);
    expect(tallies.map((c) => [c.method, c.path, c.status])).toEqual([
      ['PATCH', 'blocks/storage/posts/p', 200],
      ['PATCH', 'blocks/storage/posts/p', 200],
      ['PATCH', 'blocks/storage/posts/p', 200],
      ['PATCH', 'blocks/storage/posts/p', 200],
    ]);
    expect((await posts.get('p'))!).toMatchObject({ version: 1, counters: { views: 4 }, marks: { vote: 0 } });
  });
});

describe('update: the types', () => {
  it('a second operator, an unknown operator, a non-string mark and a non-number `by` do not compile', () => {
    const posts: StorageCollection = recorder().storage.collection('posts');
    // Never called: these lines exist for `tsc -p tsconfig.test.json` (CI's typecheck),
    // where an `@ts-expect-error` that finds no error is itself an error.
    const neverCalled = () => {
      // @ts-expect-error two operators
      void posts.update('k', { $inc: { views: 1 }, $mark: 'vote' });
      // @ts-expect-error two operators
      void posts.update('k', { $mark: 'vote', $unmark: 'vote' });
      // Not a literal, so no excess-property check: only the `?: never` fields refuse it.
      const both = { $inc: { views: 1 }, $mark: 'vote' };
      // @ts-expect-error two operators, held in a variable
      void posts.update('k', both);
      // @ts-expect-error an unknown operator
      void posts.update('k', { $set: { status: 'closed' } });
      // @ts-expect-error an unknown operator beside a known one
      void posts.update('k', { $inc: { views: 1 }, $push: 1 });
      // @ts-expect-error a mark name that is not a string
      void posts.update('k', { $mark: 1 });
      // @ts-expect-error a mark name that is not a string
      void posts.update('k', { $unmark: ['vote'] });
      // @ts-expect-error `by` that is not a number
      void posts.update('k', { $inc: { views: '1' } });
      // @ts-expect-error `by` is required: no default on the wire
      void posts.update('k', { $inc: { views: undefined } });
      // @ts-expect-error no operator at all
      void posts.update('k', {});
      // @ts-expect-error plain fields (a merge-patch) are not an operator
      void posts.update('k', { status: 'closed' });
    };
    expect(neverCalled).toBeTypeOf('function');
    // Positive control: each operator alone compiles, with its own reply type.
    expectTypeOf(posts.update('k', { $inc: { views: 2 } })).resolves.toEqualTypeOf<{ value: number }>();
    expectTypeOf(posts.update('k', { $mark: 'vote' })).resolves.toEqualTypeOf<{ marked: true; count?: number }>();
    expectTypeOf(posts.update('k', { $unmark: 'vote' })).resolves.toEqualTypeOf<{ marked: false; count?: number }>();
  });

  it('the deprecated methods keep their exact signatures', () => {
    expectTypeOf<StorageCollection['increment']>().toEqualTypeOf<
      (key: string, counter: string, by?: number, opts?: { signal?: AbortSignal }) => Promise<{ value: number }>
    >();
    expectTypeOf<StorageCollection['mark']>().toEqualTypeOf<
      (key: string, name: string, opts?: { signal?: AbortSignal }) => Promise<{ marked: true; count?: number }>
    >();
    expectTypeOf<StorageCollection['unmark']>().toEqualTypeOf<
      (key: string, name: string, opts?: { signal?: AbortSignal }) => Promise<{ marked: false; count?: number }>
    >();
  });

  it('the new names are exported from the package root', () => {
    expect(root.storageUpdateRefusal).toBe(storageUpdateRefusal);
    expectTypeOf<root.StorageUpdateOp>().toEqualTypeOf<StorageUpdateOp>();
    expectTypeOf<root.StorageUpdateRefusalReason>().toEqualTypeOf<StorageUpdateRefusalReason>();
  });
});

describe('storageUpdateRefusal', () => {
  const invalid = (details?: Record<string, unknown>) =>
    new StorageError(400, 'invalid_request', 'x', { code: 'invalid_request', message: 'x', error: 'x', details }, details);

  it.each(['empty_patch', 'unknown_operator', 'multiple_operators', 'merge_patch_unsupported', 'malformed_operator'])(
    'reads %s',
    (reason) => {
      expect(storageUpdateRefusal(invalid({ reason }))).toBe(reason);
    },
  );

  it('is null for a reason it does not list, no reason, another code, and a non-StorageError', () => {
    expect(storageUpdateRefusal(invalid({ reason: 'some_later_reason' }))).toBeNull();
    expect(storageUpdateRefusal(invalid({ counter: 'likes' }))).toBeNull();
    expect(storageUpdateRefusal(invalid())).toBeNull();
    const policy = new StorageError(403, 'write_policy', 'x', {}, { reason: 'malformed_operator' });
    expect(storageUpdateRefusal(policy)).toBeNull();
    expect(storageUpdateRefusal(new ApiError(400, 'x', { details: { reason: 'empty_patch' } }))).toBeNull();
    expect(storageUpdateRefusal(new Error('empty_patch'))).toBeNull();
  });
});

describe('the fake: PATCH refusals, as the server gives them', () => {
  /** A raw PATCH through the fake's `Http`, so a body the types forbid can be sent. */
  async function patch(fake: ReturnType<typeof make>, path: string, body: unknown, query: Record<string, string> = {}) {
    return fake.http('PATCH', `blocks/storage/${path}`, body === undefined ? { query } : { query, body }).then(
      (value) => ({ status: 200, body: value }),
      (e: unknown) => {
        if (!(e instanceof ApiError)) throw e;
        return { status: e.status, body: e.body as Record<string, unknown> };
      },
    );
  }

  async function seeded(extra: Partial<FakeStorageOptions> = {}) {
    const fake = make(extra);
    await fake.storage.collection('posts').put('p', { status: 'open' });
    return fake;
  }

  const reason = (r: { body: unknown }) => (r.body as { details?: { reason?: unknown } }).details?.reason;

  it.each([
    ['empty_patch', 'no body', undefined, { reason: 'empty_patch' }, 'PATCH needs an update operator'],
    ['empty_patch', '{}', {}, { reason: 'empty_patch' }, 'PATCH needs an update operator'],
    ['malformed_operator', 'an array', ['$mark', 'vote'], { reason: 'malformed_operator' }, 'PATCH body must be an object holding one update operator'],
    ['malformed_operator', 'a string', '$mark', { reason: 'malformed_operator' }, 'PATCH body must be an object holding one update operator'],
    ['unknown_operator', '$set', { $set: { status: 'x' } }, { reason: 'unknown_operator', operator: '$set' }, 'unknown update operator $set'],
    ['unknown_operator', 'an unknown beside a known (unknown is checked first)', { $mark: 'vote', $push: 1 }, { reason: 'unknown_operator', operator: '$push' }, 'unknown update operator $push'],
    ['multiple_operators', '$inc + $mark', { $inc: { views: 1 }, $mark: 'vote' }, { reason: 'multiple_operators', operators: ['$inc', '$mark'] }, 'PATCH takes exactly one update operator'],
    ['multiple_operators', '$mark + $unmark', { $mark: 'vote', $unmark: 'vote' }, { reason: 'multiple_operators', operators: ['$mark', '$unmark'] }, 'PATCH takes exactly one update operator'],
    ['merge_patch_unsupported', 'plain fields', { status: 'closed' }, { reason: 'merge_patch_unsupported' }, 'PATCH takes an update operator ($inc, $mark or $unmark); to change data, PUT the document'],
    ['malformed_operator', 'an operator beside a field', { $mark: 'vote', status: 'closed' }, { reason: 'malformed_operator', operator: '$mark' }, '$mark cannot be combined with other fields'],
    ['malformed_operator', 'a report with a payload', { $mark: 'report', reason: 'spam' }, { reason: 'malformed_operator', operator: '$mark' }, '$mark cannot be combined with other fields'],
    ['malformed_operator', '$inc of two counters', { $inc: { views: 1, plays: 1 } }, { reason: 'malformed_operator' }, '$inc names exactly one counter: {"<counter>": by}'],
    ['malformed_operator', '$inc of none', { $inc: {} }, { reason: 'malformed_operator' }, '$inc names exactly one counter: {"<counter>": by}'],
    ['malformed_operator', '$inc of a number', { $inc: 1 }, { reason: 'malformed_operator' }, '$inc names exactly one counter: {"<counter>": by}'],
    ['malformed_operator', '$inc of an array', { $inc: [1] }, { reason: 'malformed_operator' }, '$inc names exactly one counter: {"<counter>": by}'],
    ['malformed_operator', 'a numeric $mark', { $mark: 1 }, { reason: 'malformed_operator', operator: '$mark' }, '$mark takes a mark name'],
    ['malformed_operator', 'an array $unmark', { $unmark: ['vote'] }, { reason: 'malformed_operator', operator: '$unmark' }, '$unmark takes a mark name'],
  ])('%s (%s): 400 invalid_request, its details and message', async (_reason, _what, body, details, message) => {
    const fake = await seeded();
    const r = await patch(fake, 'posts/p', body);
    expect(r).toEqual({ status: 400, body: { code: 'invalid_request', message, error: message, details } });
  });

  it('multiple_operators: two operators are refused and nothing is tallied', async () => {
    const fake = await seeded();
    const posts = fake.storage.collection('posts');
    const two = { $inc: { views: 1 }, $mark: 'vote' } as unknown as StorageUpdateOp;
    const error = await refusal(posts.update('p', two));
    expect([error.status, error.code, storageUpdateRefusal(error)]).toEqual([400, 'invalid_request', 'multiple_operators']);
    expect((await posts.get('p'))!).toMatchObject({ counters: { views: 0 }, marks: { vote: 0 }, viewer: { marks: [] } });
  });

  it('every reason reaches the caller through update() as a StorageError, read by storageUpdateRefusal', async () => {
    const fake = await seeded();
    const posts = fake.storage.collection('posts');
    const send = (op: unknown) => refusal(posts.update('p', op as StorageUpdateOp)).then(storageUpdateRefusal);
    expect(
      await Promise.all([undefined, { $set: 1 }, { $inc: { views: 1 }, $unmark: 'vote' }, { status: 'x' }, { $mark: 2 }].map(send)),
    ).toEqual(['empty_patch', 'unknown_operator', 'multiple_operators', 'merge_patch_unsupported', 'malformed_operator']);
  });

  it('a wrong VALUE inside a well-formed operator is the deprecated route\'s refusal, with no reason', async () => {
    const fake = await seeded();
    for (const by of ['1', 1.5, 0, 101, null]) {
      const r = await patch(fake, 'posts/p', { $inc: { views: by } });
      expect([r.status, (r.body as { code?: string }).code, reason(r)]).toEqual([400, 'invalid_request', undefined]);
    }
    const undeclared = await patch(fake, 'posts/p', { $inc: { likes: 1 } });
    expect(undeclared.body).toMatchObject({ code: 'invalid_request', details: { counter: 'likes' } });
    const star = await patch(fake, 'posts/p', { $mark: 'star' });
    expect(star.body).toMatchObject({ code: 'invalid_request', details: { mark: 'star' } });
    const priv = await patch(fake, 'prefs/k', { $mark: 'vote' });
    expect([priv.status, (priv.body as { code?: string }).code]).toEqual([400, 'invalid_request']);
  });

  it('$unmark report is refused 400 for everyone, before sign-in, with the deprecated route\'s details', async () => {
    const fake = await seeded();
    const anon = await refusal(fake.as({ viewer: null }).storage.collection('posts').update('p', { $unmark: 'report' }));
    expect([anon.status, anon.code, anon.details]).toEqual([400, 'invalid_request', { mark: 'report' }]);
    const absent = await refusal(fake.storage.collection('posts').update('absent', { $unmark: 'report' }));
    expect([absent.status, absent.code]).toEqual([400, 'invalid_request']);
  });

  it('the body is read before the collection, sign-in or any budget: a malformed body on an undeclared collection is a 400', async () => {
    const fake = await seeded();
    const r = await patch(fake, 'nope/k', { $inc: { views: 1 }, $mark: 'vote' });
    expect([r.status, reason(r)]).toEqual([400, 'multiple_operators']);
    const anon = await fake.as({ viewer: null }).http('PATCH', 'blocks/storage/posts/p', { body: {} }).catch((e: ApiError) => e);
    expect([(anon as ApiError).status, ((anon as ApiError).body as { details?: unknown }).details]).toEqual([400, { reason: 'empty_patch' }]);
    // A well-formed one then meets the route's own checks, in their order.
    expect((await patch(fake, 'nope/k', { $mark: 'vote' })).body).toMatchObject({ code: 'collection_not_declared' });
    const anonMark = await refusal(fake.as({ viewer: null }).storage.collection('posts').update('p', { $mark: 'vote' }));
    expect(anonMark.code).toBe('sign_in_required');
  });

  it('a stray query parameter is refused before the body is read', async () => {
    const fake = await seeded();
    const r = await patch(fake, 'posts/p', { $mark: 'vote', extra: 1 }, { ifVersion: '1' });
    expect(r.body).toMatchObject({ code: 'invalid_request', message: 'unknown query parameter ifVersion' });
    expect(reason(r)).toBeUndefined();
  });

  it('a refused body spends no tally budget; a well-formed tally does', async () => {
    const fake = await seeded({ enforceRateLimits: true });
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 40; i++) await refusal(posts.update('p', {} as unknown as StorageUpdateOp));
    for (let i = 0; i < 30; i++) await posts.update('p', { $inc: { views: 1 } });
    const limited = await refusal(posts.update('p', { $mark: 'vote' }));
    expect(limited.details).toMatchObject({ bucket: 'tally' });
  });
});

describe('the fake: PATCH happy paths', () => {
  it('$inc: creates the document in a write:none collection, then adds; data and version never move', async () => {
    const fake = make();
    const plays = fake.storage.collection('plays');
    expect(await plays.update('m', { $inc: { plays: 3 } })).toEqual({ value: 3 });
    expect(await plays.update('m', { $inc: { plays: 100 } })).toEqual({ value: 103 });
    expect((await plays.get('m'))!).toMatchObject({ data: {}, version: 1, author: { kind: 'counter' }, counters: { plays: 103 } });
    // write:own: the document must exist.
    expect((await refusal(fake.storage.collection('posts').update('absent', { $inc: { views: 1 } }))).code).toBe('not_found');
  });

  it('$mark / $unmark: idempotent per viewer, counted across viewers; report is counted nowhere', async () => {
    const fake = make();
    const posts = fake.storage.collection('posts');
    await posts.put('p', { status: 'open' });
    const bob = fake.as({ viewer: { username: 'bob', id: 913_011 } }).storage.collection('posts');
    expect(await posts.update('p', { $mark: 'vote' })).toEqual({ marked: true, count: 1 });
    expect(await posts.update('p', { $mark: 'vote' })).toEqual({ marked: true, count: 1 });
    expect(await bob.update('p', { $mark: 'vote' })).toEqual({ marked: true, count: 2 });
    expect(await posts.update('p', { $unmark: 'vote' })).toEqual({ marked: false, count: 1 });
    expect(await posts.update('p', { $unmark: 'vote' })).toEqual({ marked: false, count: 1 });
    expect(await bob.update('p', { $mark: 'report' })).toEqual({ marked: true });
    const doc = (await posts.get('p'))!;
    expect(doc).toMatchObject({ data: { status: 'open' }, version: 1, marks: { vote: 1 } });
    expect(doc.marks).not.toHaveProperty('report');
    expect((await bob.get('p'))!.viewer).toEqual({ marks: ['vote', 'report'] });
  });

  it('the PATCH and the deprecated route tally the same counter', async () => {
    const fake = make();
    await fake.storage.collection('plays').update('m', { $inc: { plays: 2 } });
    const legacy = await fake.http<{ value: number }>('POST', 'blocks/storage/plays/m/counters/plays', {});
    expect(legacy).toEqual({ value: 3 });
  });
});
