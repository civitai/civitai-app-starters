import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import { StorageError, storageImportRefusal } from '../../src/doc-store/index.js';
import { createModerationClient } from '../../src/doc-store/moderation.js';
import { ApiError, type Http, type RequestOptions } from '../../src/http/index.js';
import { createFakeStorage, type FakeStorageOptions } from '../../src/testing.js';
import { jsonResponse } from '../support/wire.js';

/**
 * THE REPORT MODERATION API (civitai/civitai#10215): `app.moderation.report({ collection, key,
 * from? })` → `POST /api/v1/blocks/moderation/reports` → `{ reported: true }`. The server's
 * answers are pinned as fixtures copied from its source (`src/pages/api/v1/blocks/moderation/
 * reports.ts` and `createReportHandler` in `doc-store-report-api.ts`, civitai main 79a4a44930).
 */

function recorder(answer: (method: string, path: string, opts: RequestOptions) => unknown = () => ({ reported: true })) {
  const sent: { method: string; path: string; opts: RequestOptions }[] = [];
  const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
    sent.push({ method, path, opts });
    const out = answer(method, path, opts);
    if (out instanceof Error) throw out;
    return out;
  }) as Http;
  return { http, sent, moderation: createModerationClient(http) };
}

const envelope = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(status, message, { code, message, error: message, ...(details ? { details } : {}) });

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: unknown) => error as StorageError,
  );

describe('request shape', () => {
  it('POSTs exactly `{ collection, key }` to blocks/moderation/reports, no query', async () => {
    const r = recorder();
    expect(await r.moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });
    expect(r.sent).toHaveLength(1);
    expect([r.sent[0]!.method, r.sent[0]!.path, JSON.stringify(r.sent[0]!.opts.body), r.sent[0]!.opts.query]).toEqual([
      'POST',
      'blocks/moderation/reports',
      '{"collection":"posts","key":"p1"}',
      undefined,
    ]);
  });

  it('a `from` travels in the body', async () => {
    const r = recorder();
    await r.moderation.report({ collection: 'posts', key: 'p1', from: 'parent-app' });
    expect(JSON.stringify(r.sent[0]!.opts.body)).toBe('{"collection":"posts","key":"p1","from":"parent-app"}');
  });

  it.each([[undefined], [null], [42]])('`from: %s` is refused before sending — it would report in THIS app', async (from) => {
    const r = recorder();
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1', from: from as unknown as string }));
    expect([error.status, error.code]).toEqual([400, 'invalid_request']);
    expect(r.sent).toEqual([]);
  });

  it.each([[''], ['..'], ['.'], ['a b'], ['a/b'], ['é'], ['k'.repeat(129)], [42], [undefined]])(
    'key %j outside the key grammar is refused before sending, so it spends no report budget',
    async (key) => {
      const r = recorder();
      const error = await refusal(r.moderation.report({ collection: 'posts', key: key as string }));
      expect(error).toBeInstanceOf(StorageError);
      expect([error.status, error.code]).toEqual([400, 'invalid_request']);
      expect(r.sent).toEqual([]);
    },
  );

  it.each([['k'.repeat(128)], ['a.b:c_d-E9'], ['.a'], [`r1:gq4z7m2k5w6c3t6y7b2d4f7h3j`]])('key %s is sent', async (key) => {
    const r = recorder();
    await r.moderation.report({ collection: 'posts', key });
    expect(r.sent).toHaveLength(1);
  });

  it('reads the reply strictly: anything but `{ reported: true }` is a CivitaiError', async () => {
    for (const reply of [{}, { reported: 'yes' }, { reported: false }, null, undefined]) {
      const r = recorder(() => reply);
      const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }));
      expect(error).toBeInstanceOf(CivitaiError);
      expect(error).not.toBeInstanceOf(StorageError);
    }
  });
});

describe('the route not served is report_unavailable; a missing document is not', () => {
  it('flag off: 404 not_found "no such route" → report_unavailable (404)', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'no such route'));
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }));
    expect(error).toBeInstanceOf(StorageError);
    expect([error.status, error.code]).toEqual([404, 'report_unavailable']);
    expect((error.cause as StorageError).code).toBe('not_found');
  });

  it('an older civitai.com without the page: a 404 without the envelope → report_unavailable', async () => {
    const r = recorder(() => new ApiError(404, 'Not Found', '<!DOCTYPE html><title>404</title>'));
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }));
    expect([error.status, error.code]).toEqual([404, 'report_unavailable']);
  });

  it('a document that is not there: 404 not_found "document not found" stays not_found', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'document not found'));
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }));
    expect([error.status, error.code]).toEqual([404, 'not_found']);
  });

  it('any other not_found sentence surfaces as it is, never as report_unavailable', async () => {
    const r = recorder(() => envelope(404, 'not_found', 'No such route.'));
    expect((await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }))).code).toBe('not_found');
  });

  it('collection_not_declared (also 404) stays itself', async () => {
    const r = recorder(() => envelope(404, 'collection_not_declared', 'collection x is not declared', { collection: 'x' }));
    expect((await refusal(r.moderation.report({ collection: 'x', key: 'p1' }))).code).toBe('collection_not_declared');
  });
});

/** The route's other answers (`[status, code, message, details]`), each reaching the caller as sent. */
const SERVER_REFUSALS: [number, string, string, Record<string, unknown> | undefined][] = [
  [401, 'unauthenticated', 'a block token is required', undefined],
  [401, 'sign_in_required', 'sign in required', undefined],
  [403, 'insufficient_scope', 'missing required scope: apps:storage', undefined],
  [405, 'method_not_allowed', 'method not allowed', undefined],
  [400, 'invalid_request', 'unknown query parameter x', undefined],
  [400, 'invalid_request', 'reports exist on shared collections only', undefined],
  [403, 'not_eligible', 'this account cannot write shared data yet', { reason: 'account_too_new' }],
  [429, 'rate_limited', 'rate limit exceeded', { bucket: 'report', retryAfter: 3600 }],
  [403, 'consent_required', 'apps:storage:publish has not been granted in parent-app', { scope: 'apps:storage:publish', from: 'parent-app' }],
];

describe('every other refusal is a StorageError as the server sent it', () => {
  it.each(SERVER_REFUSALS)('%i %s', async (status, code, message, details) => {
    const r = recorder(() => envelope(status, code, message, details));
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }));
    expect(error).toBeInstanceOf(StorageError);
    expect([error.status, error.code, error.message, error.details]).toEqual([status, code, message, details]);
  });

  it('a rate limit says how long to wait', async () => {
    const r = recorder(() => envelope(429, 'rate_limited', 'rate limit exceeded', { bucket: 'report', retryAfter: 3600 }));
    expect((await refusal(r.moderation.report({ collection: 'posts', key: 'p1' }))).retryAfter).toBe(3600);
  });

  it('through an import, an import refusal is typed by storageImportRefusal', async () => {
    const r = recorder(() =>
      envelope(403, 'import_not_declared', 'this app does not declare an import of posts from parent-app', { from: 'parent-app', collection: 'posts' }),
    );
    const error = await refusal(r.moderation.report({ collection: 'posts', key: 'p1', from: 'parent-app' }));
    expect(storageImportRefusal(error)).toEqual({ kind: 'not_declared', from: 'parent-app', collection: 'posts' });
  });
});

describe('wiring', () => {
  it('app.moderation.report reaches POST /api/v1/blocks/moderation/reports with the token', async () => {
    const seen: { url: string; method?: string; auth?: string; body?: unknown }[] = [];
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({
        url: String(input),
        method: init.method,
        auth: (init.headers as Record<string, string>).Authorization,
        body: init.body,
      });
      return jsonResponse(200, { reported: true });
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 'tok', fetch });
    expect(await app.moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });
    expect(seen).toEqual([
      {
        url: 'https://civitai.com/api/v1/blocks/moderation/reports',
        method: 'POST',
        auth: 'Bearer tok',
        body: '{"collection":"posts","key":"p1"}',
      },
    ]);
  });

  it('pins the route textually', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/doc-store/moderation.ts', import.meta.url)), 'utf8');
    expect(source).toContain("export const REPORTS_PATH = 'blocks/moderation/reports'");
  });
});

// ---------------------------------------------------------------------------
// The fake (and so the local preview)
// ---------------------------------------------------------------------------

const MANIFEST = {
  scopes: ['apps:storage', 'apps:storage:publish'],
  storage: {
    collections: {
      posts: { visibility: 'shared', write: 'own', marks: ['vote'] },
      votes: { visibility: 'shared', write: 'own', keyedBy: 'parent+viewer' },
      notes: { visibility: 'private' },
    },
  },
};

const fakeWith = (extra: Partial<FakeStorageOptions> = {}) => createFakeStorage({ manifest: MANIFEST, reports: true, ...extra });

describe('fake: the report API', () => {
  it('off by default, as on civitai.com: report_unavailable', async () => {
    const fake = createFakeStorage({ manifest: MANIFEST });
    await fake.storage.collection('posts').put('p1', { t: 'x' });
    const error = await refusal(fake.moderation.report({ collection: 'posts', key: 'p1' }));
    expect([error.status, error.code]).toEqual([404, 'report_unavailable']);
  });

  it('off, the route-miss comes before sign-in, for an anonymous viewer and a dev token alike', async () => {
    const fake = createFakeStorage({ manifest: MANIFEST });
    for (const caller of [{ viewer: null }, { viewer: null, token: 'dev' as const }]) {
      const error = await refusal(fake.as(caller).moderation.report({ collection: 'posts', key: 'p1' }));
      expect([error.status, error.code]).toEqual([404, 'report_unavailable']);
    }
    // Control: served, the same callers are refused sign_in_required.
    const served = fakeWith();
    for (const caller of [{ viewer: null }, { viewer: null, token: 'dev' as const }]) {
      expect((await refusal(served.as(caller).moderation.report({ collection: 'posts', key: 'p1' }))).code).toBe('sign_in_required');
    }
  });

  it('a malformed key costs no report: 20 good reports still fit after it', async () => {
    const fake = fakeWith({ enforceRateLimits: true, now: () => 1_756_000_000_123 });
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 20; i++) await posts.put(`p${i}`, { t: 'x' });
    expect((await refusal(fake.moderation.report({ collection: 'posts', key: '..' }))).code).toBe('invalid_request');
    for (let i = 0; i < 20; i++) await fake.moderation.report({ collection: 'posts', key: `p${i}` });
  });

  it('idempotent and countless: the same answer twice, and no reader sees a count', async () => {
    const fake = fakeWith();
    const posts = fake.storage.collection('posts');
    await posts.put('p1', { t: 'x' });
    const before = await posts.get('p1');
    expect(await fake.moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });
    expect(await fake.moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });
    const bob = fake.as({ viewer: { username: 'bob' } });
    expect(await bob.moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });

    const after = await bob.storage.collection('posts').get('p1');
    // Three reports moved nothing a reader sees: no count, no version, no data.
    expect([after?.counters, after?.marks, after?.version, after?.data]).toEqual([{}, { vote: 0 }, 1, { t: 'x' }]);
    expect([before?.counters, before?.marks]).toEqual([{}, { vote: 0 }]);
  });

  it('a viewer-keyed document is reportable', async () => {
    const fake = fakeWith();
    const { key } = await fake.storage.collection('votes').putMine({ value: 1 }, { parent: 'r1' });
    expect(await fake.as({ viewer: { username: 'bob' } }).moderation.report({ collection: 'votes', key })).toEqual({ reported: true });
  });

  it.each([
    ['a private collection', { collection: 'notes', key: 'n1' }, 400, 'invalid_request'],
    ['an undeclared collection', { collection: 'other', key: 'p1' }, 404, 'collection_not_declared'],
    ['a missing document', { collection: 'posts', key: 'nope' }, 404, 'not_found'],
    ['an unaddressable key', { collection: 'posts', key: '..' }, 400, 'invalid_request'],
  ])('%s is refused', async (_, request, status, code) => {
    const fake = fakeWith();
    const error = await refusal(fake.moderation.report(request));
    expect([error.status, error.code]).toEqual([status, code]);
  });

  it('an anonymous viewer is sign_in_required; an untrusted one not_eligible', async () => {
    const fake = fakeWith();
    await fake.storage.collection('posts').put('p1', { t: 'x' });
    expect((await refusal(fake.as({ viewer: null }).moderation.report({ collection: 'posts', key: 'p1' }))).code).toBe('sign_in_required');
    const untrusted = fake.as({ viewer: { username: 'new', trusted: false } });
    expect((await refusal(untrusted.moderation.report({ collection: 'posts', key: 'p1' }))).details).toEqual({ reason: 'account_too_new' });
  });

  it('needs apps:storage only: no publish scope for the app\'s own documents', async () => {
    const fake = fakeWith();
    await fake.storage.collection('posts').put('p1', { t: 'x' });
    expect(await fake.as({ scopes: ['apps:storage'] }).moderation.report({ collection: 'posts', key: 'p1' })).toEqual({ reported: true });
    expect((await refusal(fake.as({ scopes: [] }).moderation.report({ collection: 'posts', key: 'p1' }))).code).toBe('insufficient_scope');
  });

  it('spends the daily report budget: the 21st report in a day is rate_limited, bucket report', async () => {
    const fake = fakeWith({ enforceRateLimits: true, now: () => 1_756_000_000_123 });
    const posts = fake.storage.collection('posts');
    for (let i = 0; i < 21; i++) await posts.put(`p${i}`, { t: 'x' });
    for (let i = 0; i < 20; i++) await fake.moderation.report({ collection: 'posts', key: `p${i}` });
    const error = await refusal(fake.moderation.report({ collection: 'posts', key: 'p20' }));
    expect([error.code, error.details?.bucket]).toEqual(['rate_limited', 'report']);
  });

  it('only POST, and no query: the route\'s own refusals through the raw seam', async () => {
    const fake = fakeWith();
    const raw = (method: string, opts: RequestOptions) =>
      fake.http(method, 'blocks/moderation/reports', opts).then(
        () => null,
        (e: ApiError) => [e.status, (e.body as { code: string }).code],
      );
    expect(await raw('GET', {})).toEqual([405, 'method_not_allowed']);
    expect(await raw('POST', { query: { x: '1' }, body: { collection: 'posts', key: 'p1' } })).toEqual([400, 'invalid_request']);
    expect(await raw('POST', { body: { collection: 'posts', key: 'p1', reason: 'spam' } })).toEqual([400, 'invalid_request']);
    expect(await raw('POST', { body: { collection: 'posts' } })).toEqual([400, 'invalid_request']);
  });

  it('through an import, the source\'s collection and its publish consent', async () => {
    const fake = createFakeStorage({
      reports: true,
      manifest: {
        scopes: ['apps:storage', 'apps:storage:import'],
        storage: { imports: [{ from: 'parent-app', collections: ['posts'], access: 'readwrite' }] },
      },
      sources: {
        'parent-app': {
          manifest: { scopes: ['apps:storage', 'apps:storage:publish'], storage: { collections: { posts: { visibility: 'shared', write: 'own' } } } },
        },
      },
    });
    await fake.as({ app: 'parent-app' }).storage.collection('posts').put('p1', { t: 'x' });
    expect(await fake.moderation.report({ collection: 'posts', key: 'p1', from: 'parent-app' })).toEqual({ reported: true });
    // Not imported: refused by the import check, typed as one.
    const notDeclared = await refusal(fake.moderation.report({ collection: 'other', key: 'p1', from: 'parent-app' }));
    expect(storageImportRefusal(notDeclared)?.kind).toBe('not_declared');
  });
});
