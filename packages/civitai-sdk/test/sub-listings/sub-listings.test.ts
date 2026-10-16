import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import { ApiError } from '../../src/http/index.js';
import {
  SubListingError,
  type MySubListing,
  type SubListingErrorCode,
  type SubListingsClient,
  type SubListingUpsertInput,
  type SubListingUpsertResult,
  type SubListingWithdrawResult,
} from '../../src/sub-listings/index.js';
import * as root from '../../src/index.js';
import { fakeFetch, json, type FetchCall } from '../support/fake-fetch.js';

const ROUTE = 'https://civitai.com/api/v1/blocks/sub-listings';

/** The REAL client over the `fetch` seam, answering each request with the next scripted response. */
async function scripted(responses: Array<(call: FetchCall) => Response>) {
  const fake = fakeFetch(responses);
  const app = await initialize({ token: 'block-jwt-7', fetch: fake.fetch });
  return { subListings: app.subListings, calls: fake.calls };
}

const UPSERTED = { id: 'asl_01JABCDEFGHJKMNPQRSTVWXYZ0', status: 'pending', pendingEdit: false };

const sentBody = (call: FetchCall) => (call.body === undefined ? undefined : JSON.parse(call.body));

describe('app.subListings — surface', () => {
  it('🔴 exposes exactly `upsert`, `withdraw`, `mine`', async () => {
    const { subListings } = await scripted([]);
    expect(Object.keys(subListings).sort()).toEqual(['mine', 'upsert', 'withdraw']);
  });

  it('`SubListingError` and the client types are exported from the package root', () => {
    expect(root.SubListingError).toBe(SubListingError);
    expectTypeOf<root.SubListingsClient>().toEqualTypeOf<SubListingsClient>();
  });

  it('🔴 the route namespace is `blocks/sub-listings`, spelled once', () => {
    // Pinned textually beside the other `blocks/*` clients' BASE values: the
    // block-token refusal annotation in `app/index.ts` relies on every one of them
    // sitting under `blocks/`.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/sub-listings/index.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toContain("const BASE = 'blocks/sub-listings'");
  });
});

describe('app.subListings.upsert — the request', () => {
  it('🔴 POSTs the required fields to /upsert, with every absent optional LEFT OUT', async () => {
    const { subListings, calls } = await scripted([() => json(200, UPSERTED)]);

    await subListings.upsert({ itemKey: 'preset-7f3a', title: 'Moody film', subPath: 'p/preset-7f3a' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${ROUTE}/upsert`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer block-jwt-7');
    expect(calls[0]!.headers['Content-Type']).toBe('application/json');
    // Exact equality on the RAW string, so a key present as `null` (which
    // `toEqual` on a parsed object would also reject) and key order are both pinned.
    expect(calls[0]!.body).toBe(
      '{"itemKey":"preset-7f3a","title":"Moody film","subPath":"p/preset-7f3a"}',
    );
  });

  it('🔴 an optional given as `null` is left out, not sent as `null` (the server body is strict)', async () => {
    const { subListings, calls } = await scripted([() => json(200, UPSERTED)]);

    await subListings.upsert({
      itemKey: 'k-9',
      title: 'T',
      subPath: 's',
      tagline: null,
      imageId: null,
      contentRating: null,
    });

    expect(sentBody(calls[0]!)).toEqual({ itemKey: 'k-9', title: 'T', subPath: 's' });
    for (const key of ['tagline', 'imageId', 'contentRating']) {
      expect(calls[0]!.body).not.toContain(key);
    }
  });

  it('🔴 an optional given as explicit `undefined` is left out too', async () => {
    const { subListings, calls } = await scripted([() => json(200, UPSERTED)]);

    await subListings.upsert({
      itemKey: 'k-9',
      title: 'T',
      subPath: 's',
      tagline: undefined,
      imageId: undefined,
      contentRating: undefined,
    });

    expect(Object.keys(sentBody(calls[0]!)).sort()).toEqual(['itemKey', 'subPath', 'title']);
  });

  it('sends every optional that holds a value, unchanged', async () => {
    const { subListings, calls } = await scripted([() => json(200, UPSERTED)]);

    await subListings.upsert({
      itemKey: 'k-1',
      title: 'Title',
      subPath: 'a/b',
      tagline: 'A tagline',
      imageId: 4242,
      contentRating: 'pg13',
    });

    expect(sentBody(calls[0]!)).toEqual({
      itemKey: 'k-1',
      title: 'Title',
      subPath: 'a/b',
      tagline: 'A tagline',
      imageId: 4242,
      contentRating: 'pg13',
    });
  });

  it('🔴 sends nothing but the six fields — an extra property on the caller\'s object never reaches the strict body', async () => {
    const { subListings, calls } = await scripted([() => json(200, UPSERTED)]);

    // E.g. a whole app-side row passed straight through.
    const row = { itemKey: 'k-2', title: 'T2', subPath: 'x', authorUserId: 5, data: { n: 1 } };
    await subListings.upsert(row as SubListingUpsertInput);

    expect(sentBody(calls[0]!)).toEqual({ itemKey: 'k-2', title: 'T2', subPath: 'x' });
  });

  it('does not mutate the caller\'s input', async () => {
    const { subListings } = await scripted([() => json(200, UPSERTED)]);
    const input: SubListingUpsertInput = { itemKey: 'k', title: 't', subPath: 's', tagline: null };
    await subListings.upsert(input);
    expect(input).toEqual({ itemKey: 'k', title: 't', subPath: 's', tagline: null });
  });
});

describe('app.subListings.upsert — the reply', () => {
  it('resolves `{ id, status, pendingEdit }` as the server sent it', async () => {
    const reply = { id: 'asl_X', status: 'approved', pendingEdit: true };
    const { subListings } = await scripted([() => json(200, reply)]);

    const result = await subListings.upsert({ itemKey: 'k', title: 't', subPath: 's' });

    expect(result).toEqual(reply);
    expectTypeOf(result).toEqualTypeOf<SubListingUpsertResult>();
  });

  it('a malformed 200 rejects with a CivitaiError, never a half-filled result', async () => {
    const { subListings } = await scripted([() => json(200, { id: 'asl_X', status: 'pending' })]);
    await expect(subListings.upsert({ itemKey: 'k', title: 't', subPath: 's' })).rejects.toThrow(
      CivitaiError,
    );
  });
});

describe('app.subListings.withdraw', () => {
  it('🔴 POSTs `{ itemKey }` to /withdraw and resolves the `withdrawn` flag', async () => {
    const { subListings, calls } = await scripted([
      () => json(200, { ok: true, withdrawn: true }),
      () => json(200, { ok: true, withdrawn: false }),
    ]);

    const first = await subListings.withdraw('preset-1');
    const second = await subListings.withdraw('preset-2');

    expect(calls.map((c) => `${c.method} ${c.url} ${c.body}`)).toEqual([
      `POST ${ROUTE}/withdraw {"itemKey":"preset-1"}`,
      `POST ${ROUTE}/withdraw {"itemKey":"preset-2"}`,
    ]);
    expect(first).toEqual({ ok: true, withdrawn: true });
    // `false` is a success: nothing of the viewer's was active under that key.
    expect(second).toEqual({ ok: true, withdrawn: false });
    expectTypeOf(second).toEqualTypeOf<SubListingWithdrawResult>();
  });

  it('a reply without a boolean `withdrawn` rejects', async () => {
    const { subListings } = await scripted([() => json(200, { ok: true })]);
    await expect(subListings.withdraw('k')).rejects.toThrow(CivitaiError);
  });
});

describe('app.subListings.mine', () => {
  const ROW = {
    id: 'asl_01',
    itemKey: 'preset-3',
    status: 'hidden',
    title: 'Mine',
    pendingEdit: false,
    statusReason: 'off-topic',
    editRejectionReason: null,
    updatedAt: '2026-03-04T05:06:07.008Z',
  };

  it('🔴 GETs /mine with no body and revives `updatedAt` as a Date', async () => {
    const { subListings, calls } = await scripted([() => json(200, { items: [ROW] })]);

    const { items } = await subListings.mine();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${ROUTE}/mine`);
    expect(calls[0]!.body).toBeUndefined();
    expect(items).toEqual([{ ...ROW, updatedAt: new Date('2026-03-04T05:06:07.008Z') }]);
    expect(items[0]!.updatedAt).toBeInstanceOf(Date);
    expectTypeOf(items).toEqualTypeOf<MySubListing[]>();
  });

  it('an empty list is a real answer', async () => {
    const { subListings } = await scripted([() => json(200, { items: [] })]);
    await expect(subListings.mine()).resolves.toEqual({ items: [] });
  });

  it('🔴 a reply without `items` rejects rather than reading as "nothing in the store"', async () => {
    const { subListings } = await scripted([() => json(200, {})]);
    await expect(subListings.mine()).rejects.toThrow(CivitaiError);
  });

  it('a malformed row or timestamp rejects', async () => {
    const { subListings } = await scripted([
      () => json(200, { items: [{ ...ROW, pendingEdit: 'no' }] }),
      () => json(200, { items: [{ ...ROW, updatedAt: 'not a date' }] }),
      () => json(200, { items: [{ ...ROW, updatedAt: null }] }),
    ]);
    await expect(subListings.mine()).rejects.toThrow('malformed item');
    await expect(subListings.mine()).rejects.toThrow('malformed item timestamp');
    await expect(subListings.mine()).rejects.toThrow('malformed item');
  });
});

describe('app.subListings — refusals', () => {
  it('🔴 a `{ error, code }` refusal rejects as a SubListingError that IS an ApiError', async () => {
    const body = { error: 'This app may not publish store items', code: 'not_enabled' };
    const { subListings } = await scripted([() => json(403, body)]);

    const error = await subListings
      .upsert({ itemKey: 'k', title: 't', subPath: 's' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SubListingError);
    expect(error).toBeInstanceOf(ApiError);
    const refusal = error as SubListingError;
    expect(refusal.name).toBe('SubListingError');
    expect(refusal.code).toBe('not_enabled');
    expect(refusal.status).toBe(403);
    expect(refusal.message).toBe('This app may not publish store items');
    expect(refusal.body).toEqual(body);
    expect((refusal as Error & { cause?: unknown }).cause).toBeInstanceOf(ApiError);
  });

  it('every route the client wraps maps its refusal the same way', async () => {
    const { subListings } = await scripted([
      () => json(429, { error: 'Too many store item updates, retry later', code: 'rate_limited' }),
      () => json(503, { error: 'Store items are not available yet', code: 'unavailable' }),
    ]);

    await expect(subListings.withdraw('k')).rejects.toMatchObject({
      name: 'SubListingError',
      status: 429,
      code: 'rate_limited',
    });
    await expect(subListings.mine()).rejects.toMatchObject({
      name: 'SubListingError',
      status: 503,
      code: 'unavailable',
    });
  });

  it('🔴 a refusal WITHOUT a string `code` stays a plain ApiError', async () => {
    // Two of the token wrapper's refusals have never carried a code.
    const { subListings } = await scripted([
      () => json(401, { error: 'Block token required' }),
      () => json(401, { error: 'Block token required' }), // the one fresh-token retry
      () => json(500, 'boom'),
    ]);

    const noCode = await subListings.mine().catch((e: unknown) => e);
    expect(noCode).toBeInstanceOf(ApiError);
    expect(noCode).not.toBeInstanceOf(SubListingError);

    const notJson = await subListings.mine().catch((e: unknown) => e);
    expect(notJson).toBeInstanceOf(ApiError);
    expect(notJson).not.toBeInstanceOf(SubListingError);
  });

  it('a request that never reached the server is not dressed up as a refusal', async () => {
    const app = await initialize({
      token: 't',
      fetch: (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch,
    });
    const error = await app.subListings.mine().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
  });

  it('`code` is typed as the known union, and still admits a code this version does not name', () => {
    expectTypeOf<'author_cap'>().toMatchTypeOf<SubListingErrorCode>();
    expectTypeOf<'insufficient_scope'>().toMatchTypeOf<SubListingErrorCode>();
    expectTypeOf<'some_future_code'>().toMatchTypeOf<SubListingErrorCode>();
    expectTypeOf<SubListingError['code']>().toEqualTypeOf<SubListingErrorCode>();
  });
});
