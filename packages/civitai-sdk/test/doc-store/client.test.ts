import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { initialize } from '../../src/app/index.js';
import { CivitaiError } from '../../src/core/errors.js';
import { createDocumentStorage, StorageError } from '../../src/doc-store/index.js';
import { ApiError, type Http, type RequestOptions } from '../../src/http/index.js';
import { createFakeStorage } from '../../src/testing.js';
import { jsonResponse } from '../support/wire.js';

/** An `Http` that records what the client sent and answers from a script. */
function recorder(answer: (method: string, path: string, opts: RequestOptions) => unknown = () => ({})) {
  const sent: { method: string; path: string; opts: RequestOptions }[] = [];
  const http = (async (method: string, path: string, opts: RequestOptions = {}) => {
    sent.push({ method, path, opts });
    const out = answer(method, path, opts);
    if (out instanceof Error) throw out;
    return out;
  }) as Http;
  return { http, sent, storage: createDocumentStorage(http) };
}

/** A wire document with every field pairwise distinct. */
const WIRE_DOC = {
  key: 'p1',
  data: { title: 'hello' },
  version: 3,
  createdAt: '2026-05-06T07:08:09.010Z',
  updatedAt: '2026-05-07T08:09:10.011Z',
  author: { kind: 'user', isViewer: false, username: 'someone' },
  counters: { views: 4 },
  marks: { vote: 2 },
  viewer: { marks: ['vote'] },
};

const envelope = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiError(status, `${code} said the server`, {
    code,
    message: `${code} said the server`,
    error: `${code} said the server`,
    ...(details ? { details } : {}),
  });

describe('request shapes', () => {
  it('get / getMany / put / create / delete', async () => {
    const r = recorder((method, path) => {
      if (path.includes('/_get/')) return { items: [WIRE_DOC, null] };
      if (method === 'DELETE') return { deleted: true };
      return WIRE_DOC;
    });
    const posts = r.storage.collection('posts');
    await posts.get('p1');
    await posts.getMany(['p1', 'p2']);
    await posts.put('p1', { title: 'a' });
    await posts.put('p1', { title: 'b' }, { ifVersion: 0 });
    await posts.create({ title: 'c' });
    await posts.delete('p1');
    await posts.delete('p1', { ifVersion: 7 });

    expect(r.sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET blocks/storage/posts/p1',
      'POST blocks/storage/_get/posts',
      'PUT blocks/storage/posts/p1',
      'PUT blocks/storage/posts/p1',
      'POST blocks/storage/posts',
      'DELETE blocks/storage/posts/p1',
      'DELETE blocks/storage/posts/p1',
    ]);
    expect(r.sent[0]!.opts.body).toBeUndefined();
    expect(r.sent[1]!.opts.body).toEqual({ keys: ['p1', 'p2'] });
    // What goes on the wire: an unconditional put carries no `ifVersion` at all,
    // and `ifVersion: 0` (create-only) is sent, not dropped as falsy.
    expect(JSON.stringify(r.sent[2]!.opts.body)).toBe('{"data":{"title":"a"}}');
    expect(JSON.stringify(r.sent[3]!.opts.body)).toBe('{"data":{"title":"b"},"ifVersion":0}');
    expect(r.sent[4]!.opts.body).toEqual({ data: { title: 'c' } });
    expect(r.sent[5]!.opts.query).toEqual({ ifVersion: undefined });
    expect(r.sent[5]!.opts.body).toBeUndefined();
    expect(r.sent[6]!.opts.query).toEqual({ ifVersion: 7 });
  });

  it('list sends one parameter per field, where[...] per filter, a Date as ISO', async () => {
    const r = recorder(() => ({ items: [], nextCursor: null }));
    await r.storage.collection('posts').list();
    await r.storage.collection('posts').list({
      where: { at: new Date('2026-01-02T03:04:05.006Z') },
      sort: '-counter:views',
      author: 'me',
      markedBy: 'me',
      mark: 'vote',
      keyPrefix: 'k:',
      limit: 7,
      cursor: 'ta~3~p9',
    });
    expect(r.sent.map((s) => `${s.method} ${s.path}`)).toEqual(['GET blocks/storage/posts', 'GET blocks/storage/posts']);
    // Absent fields stay undefined, so the URL builder drops them and the server's defaults apply.
    expect(Object.entries(r.sent[0]!.opts.query!).filter(([, v]) => v !== undefined)).toEqual([]);
    expect(Object.fromEntries(Object.entries(r.sent[1]!.opts.query!).filter(([, v]) => v !== undefined))).toEqual({
      'where[at]': '2026-01-02T03:04:05.006Z',
      sort: '-counter:views',
      author: 'me',
      markedBy: 'me',
      mark: 'vote',
      keyPrefix: 'k:',
      limit: 7,
      cursor: 'ta~3~p9',
    });
  });

  it('increment / mark / unmark / info', async () => {
    const r = recorder((method, path) => {
      if (path.includes('/counters/')) return { value: 9 };
      if (path.includes('/marks/')) return method === 'PUT' ? { marked: true, count: 2 } : { marked: false, count: 1 };
      return { collections: {}, limits: {}, usage: {} };
    });
    const plays = r.storage.collection('plays');
    await plays.increment('m1', 'plays');
    await plays.increment('m1', 'plays', 3);
    await plays.mark('m1', 'vote');
    await plays.unmark('m1', 'vote');
    await r.storage.info();
    expect(r.sent.map((s) => `${s.method} ${s.path}`)).toEqual([
      'POST blocks/storage/plays/m1/counters/plays',
      'POST blocks/storage/plays/m1/counters/plays',
      'PUT blocks/storage/plays/m1/marks/vote',
      'DELETE blocks/storage/plays/m1/marks/vote',
      'GET blocks/storage',
    ]);
    // No body at all without `by`: the server's default applies.
    expect(r.sent[0]!.opts.body).toBeUndefined();
    expect(r.sent[1]!.opts.body).toEqual({ by: 3 });
    // A mark carries no payload.
    expect(r.sent[2]!.opts.body).toBeUndefined();
  });

  it('encodes every caller-supplied segment', async () => {
    const r = recorder(() => ({ value: 1 }));
    await r.storage.collection('c').increment('a:b/c d?e', 'n#1');
    expect(r.sent[0]!.path).toBe('blocks/storage/c/a%3Ab%2Fc%20d%3Fe/counters/n%231');
  });

  it.each([
    ['key', '', (s: ReturnType<typeof createDocumentStorage>) => s.collection('c').get('')],
    ['key', '.', (s: ReturnType<typeof createDocumentStorage>) => s.collection('c').put('.', {})],
    ['key', '..', (s: ReturnType<typeof createDocumentStorage>) => s.collection('c').delete('..')],
    ['collection', '..', (s: ReturnType<typeof createDocumentStorage>) => s.collection('..').list()],
    ['counter', '.', (s: ReturnType<typeof createDocumentStorage>) => s.collection('c').increment('k', '.')],
    ['mark', '', (s: ReturnType<typeof createDocumentStorage>) => s.collection('c').mark('k', '')],
  ])('refuses a %s of %j before sending — a URL would rewrite it into another route', async (_what, _value, run) => {
    const r = recorder();
    const error = await run(r.storage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).code).toBe('invalid_request');
    expect((error as StorageError).status).toBe(400);
    expect(r.sent).toEqual([]);
  });

  it('sends a dot-only key that is NOT a path step (`...`) and lets the server refuse it', async () => {
    const r = recorder(() => envelope(400, 'invalid_request'));
    await expect(r.storage.collection('c').put('...', {})).rejects.toBeInstanceOf(StorageError);
    expect(r.sent.map((s) => s.path)).toEqual(['blocks/storage/c/...']);
  });
});

describe('reading replies', () => {
  it('revives timestamps and copies the author by field', async () => {
    const leaky = { ...WIRE_DOC, author: { ...WIRE_DOC.author, uid: 730041, extra: 'x' } };
    const r = recorder(() => leaky);
    const doc = await r.storage.collection('posts').get('p1');
    expect(doc!.createdAt).toBeInstanceOf(Date);
    expect(doc!.createdAt.getTime()).toBe(Date.parse(WIRE_DOC.createdAt));
    expect(doc!.updatedAt.getTime()).toBe(Date.parse(WIRE_DOC.updatedAt));
    expect(doc!.author).toEqual({ kind: 'user', isViewer: false, username: 'someone' });
    expect(doc).toMatchObject({ key: 'p1', version: 3, counters: { views: 4 }, marks: { vote: 2 }, viewer: { marks: ['vote'] } });
  });

  it.each([
    ['a null timestamp', { ...WIRE_DOC, createdAt: null }],
    ['an unparseable timestamp', { ...WIRE_DOC, updatedAt: 'yesterday' }],
    ['an unknown author kind', { ...WIRE_DOC, author: { kind: 'robot' } }],
    ['a non-object data', { ...WIRE_DOC, data: 'x' }],
    ['a non-numeric counter', { ...WIRE_DOC, counters: { views: '4' } }],
    ['a missing viewer', { ...WIRE_DOC, viewer: undefined }],
  ])('a malformed document (%s) throws rather than reading as data', async (_why, reply) => {
    const r = recorder(() => reply);
    await expect(r.storage.collection('posts').get('p1')).rejects.toBeInstanceOf(CivitaiError);
  });

  it('list: `nextCursor` passes through verbatim, `null` stays null, a missing one throws', async () => {
    let next: unknown = 'sa~b3Blbg~p1';
    const r = recorder(() => ({ items: [WIRE_DOC], ...(next === 'omit' ? {} : { nextCursor: next }) }));
    expect((await r.storage.collection('posts').list()).nextCursor).toBe('sa~b3Blbg~p1');
    next = null;
    expect((await r.storage.collection('posts').list()).nextCursor).toBeNull();
    next = 'omit';
    await expect(r.storage.collection('posts').list()).rejects.toThrow(/nextCursor/);
  });

  it('list and getMany refuse a reply without the array (never an empty page)', async () => {
    const r = recorder(() => ({ nextCursor: null }));
    await expect(r.storage.collection('posts').list()).rejects.toThrow(/items/);
    await expect(r.storage.collection('posts').getMany(['a'])).rejects.toThrow(/items/);
  });

  it('getMany keeps order and nulls, and refuses a reply of the wrong length', async () => {
    let items: unknown[] = [null, WIRE_DOC];
    const r = recorder(() => ({ items }));
    const out = await r.storage.collection('posts').getMany(['missing', 'p1']);
    expect(out.map((d) => d?.key ?? null)).toEqual([null, 'p1']);
    items = [WIRE_DOC];
    await expect(r.storage.collection('posts').getMany(['missing', 'p1'])).rejects.toThrow(/items/);
  });

  it('mark results: `count` absent for report, present otherwise; a wrong `marked` throws', async () => {
    let reply: unknown = { marked: true };
    const r = recorder(() => reply);
    expect(await r.storage.collection('posts').mark('p1', 'report')).toEqual({ marked: true });
    reply = { marked: true, count: 4 };
    expect(await r.storage.collection('posts').mark('p1', 'vote')).toEqual({ marked: true, count: 4 });
    reply = { marked: true, count: 4 };
    await expect(r.storage.collection('posts').unmark('p1', 'vote')).rejects.toThrow(/malformed/);
  });
});

describe('errors', () => {
  it('an envelope becomes a StorageError with code, status, details and retryAfter', async () => {
    const original = envelope(429, 'rate_limited', { bucket: 'tally', retryAfter: 17 });
    const r = recorder(() => original);
    const error = (await r.storage.collection('posts').increment('p1', 'views').catch((e: unknown) => e)) as StorageError;
    expect(error).toBeInstanceOf(StorageError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe('StorageError');
    expect(error.code).toBe('rate_limited');
    expect(error.status).toBe(429);
    expect(error.details).toEqual({ bucket: 'tally', retryAfter: 17 });
    expect(error.retryAfter).toBe(17);
    expect(error.body).toBe(original.body);
    expect(error.message).toBe('rate_limited said the server');
    expect(error.cause).toBe(original);
  });

  it('retryAfter is undefined when the server named none', async () => {
    const r = recorder(() => envelope(409, 'version_conflict', { currentVersion: 2 }));
    const error = (await r.storage.collection('p').put('k', {}, { ifVersion: 1 }).catch((e: unknown) => e)) as StorageError;
    expect(error.details).toEqual({ currentVersion: 2 });
    expect(error.retryAfter).toBeUndefined();
  });

  it('a non-envelope ApiError and a non-API error pass through untouched', async () => {
    const proxy = new ApiError(502, 'Bad Gateway', '<html>');
    const r1 = recorder(() => proxy);
    await expect(r1.storage.collection('p').list()).rejects.toBe(proxy);
    const bug = new TypeError('boom');
    const r2 = recorder(() => bug);
    await expect(r2.storage.collection('p').list()).rejects.toBe(bug);
  });

  it('get reads ONLY not_found as null; collection_not_declared (also a 404) throws', async () => {
    let refusal = envelope(404, 'not_found');
    const r = recorder(() => refusal);
    expect(await r.storage.collection('posts').get('p1')).toBeNull();
    refusal = envelope(404, 'collection_not_declared', { collection: 'postz' });
    await expect(r.storage.collection('postz').get('p1')).rejects.toMatchObject({ code: 'collection_not_declared' });
    // A 404 with no envelope — a site with no such route, as civitai.com answers before
    // the storage routes ship — is not "no document" either.
    refusal = new ApiError(404, 'Not Found', '<!DOCTYPE html>');
    await expect(r.storage.collection('posts').get('p1')).rejects.toBe(refusal);
  });
});

describe('paging against the fake', () => {
  it.each(['key', '-key', 'createdAt', '-updatedAt', 'rank', '-rank', 'counter:views'])(
    'follows nextCursor to the end, sort %s: every document once, in order',
    async (sort) => {
      let t = 1_700_000_000_000;
      const fake = createFakeStorage({
        manifest: {
          scopes: ['apps:storage', 'apps:storage:publish'],
          storage: {
            collections: {
              posts: { visibility: 'shared', write: 'own', counters: ['views'], indexes: { rank: 'number' } },
            },
          },
        },
        now: () => (t += 1000),
      });
      const posts = fake.storage.collection<{ rank: number }>('posts');
      // Ranks and view counts repeat, so the key tiebreak inside the cursor is exercised.
      const ranks = [3, 1, 2, 3, 1, 2, 3];
      for (const [i, rank] of ranks.entries()) {
        await posts.put(`k${i}`, { rank });
        for (let v = 0; v < rank; v++) await posts.increment(`k${i}`, 'views');
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await posts.list({ sort, limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(...page.items.map((d) => d.key));
        cursor = page.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 20);
      const all = (await posts.list({ sort, limit: 100 })).items.map((d) => d.key);
      expect(all).toHaveLength(ranks.length);
      expect(seen).toEqual(all);
      expect(pages).toBe(Math.ceil(ranks.length / 2));
    },
  );
});

describe('wiring', () => {
  it('app.storage carries the document store beside the legacy methods, at /api/v1/blocks/storage', async () => {
    const seen: { url: string; method?: string; auth?: string }[] = [];
    const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      seen.push({ url: String(input), method: init.method, auth: (init.headers as Record<string, string>).Authorization });
      return jsonResponse(200, WIRE_DOC);
    }) as typeof globalThis.fetch;
    const app = await initialize({ token: 'tok', fetch });
    for (const name of ['collection', 'info', 'get', 'set', 'delete', 'list', 'getQuota'] as const) {
      expect(typeof app.storage[name], name).toBe('function');
    }
    const doc = await app.storage.collection('posts').get('p1');
    expect(doc?.key).toBe('p1');
    expect(seen).toEqual([{ url: 'https://civitai.com/api/v1/blocks/storage/posts/p1', method: 'GET', auth: 'Bearer tok' }]);
  });

  it('a refusal on these routes reaches the caller as a StorageError, message as sent', async () => {
    const fetch = (async () =>
      jsonResponse(403, { code: 'consent_required', message: 'no', error: 'no', details: { scope: 'apps:storage:publish' } })) as typeof globalThis.fetch;
    const app = await initialize({ token: 'tok', fetch });
    const error = (await app.storage.collection('posts').put('p1', {}).catch((e: unknown) => e)) as StorageError;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe('consent_required');
    expect(error.message).toBe('no');
  });

  it('pins the route base textually', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/doc-store/index.ts', import.meta.url)), 'utf8');
    expect(source).toContain("const BASE = 'blocks/storage'");
  });
});
