import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { build, type Rollup } from 'vite';

import { initialize, StorageError } from '../../src/index.js';
import { snapshotFromInit, type BlockSnapshot } from '../../src/core/transport.js';
import type { BlockInitPayload } from '../../src/core/handshake.js';
import { INSUFFICIENT_SCOPE_HINT } from '../../src/doc-store/index.js';
import { LOCAL_PREVIEW_MANIFEST_GLOBAL } from '../../src/doc-store/local-preview.js';
import { createFakeTransport } from '../../src/testing.js';
import { fakeFetch, json, type FetchCall } from '../support/fake-fetch.js';

/**
 * civitai/civitai-app-starters#710: a dev-tunnel preview has no server-side
 * storage, so when the host marks the frame `storageMode: 'local-preview'` the
 * document store is an in-memory one in the tab — and ONLY then.
 *
 * Fixture choices that carry the proof:
 * - The token holds `user:read:self` and NO storage scope, while the manifest
 *   declares `apps:storage`. The local store's caller defaults to the MANIFEST's
 *   scopes, so a build that switched on `token.scopes` (or always used the local
 *   store) would answer a no-signal call from memory and succeed — the control
 *   and no-redirect cases below would then go red.
 * - `fetch` is a recording spy that answers EVERY request the way the real
 *   route answers a preview token (403 `insufficient_scope`), so a request the
 *   local path made is recorded rather than crashing the test, and the
 *   zero-request assertion — checked FIRST — is what goes red. The control
 *   case is its positive control: the same spy records one call.
 */

const MANIFEST = {
  scopes: ['apps:storage', 'user:read:self'],
  storage: { collections: { notes: { visibility: 'private' } } },
};
const TOKEN_SCOPES = ['user:read:self'];

const storageCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.includes('/blocks/storage'));

function block(extra: Partial<BlockSnapshot> = {}) {
  return createFakeTransport({
    token: { raw: 'tunnel-token', scopes: TOKEN_SCOPES, expiresAt: new Date(0), kind: 'block' },
    viewer: { id: 41, username: 'dev' },
    context: { slotId: 'app.page' },
    ...extra,
  });
}

const insufficientScope = () =>
  json(403, {
    code: 'insufficient_scope',
    message: 'missing required scope: apps:storage',
    error: 'missing required scope: apps:storage',
  });

/** Every request recorded and refused as the real route refuses a tunnel token. */
function realRoutes() {
  const calls: FetchCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), method: init.method ?? 'GET', headers: init.headers as Record<string, string> });
    return insufficientScope();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const settle = <T>(p: Promise<T>) => p.then((value) => ({ value }), (error: unknown) => ({ error }));

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL];
});

describe('dev-tunnel preview: the document store is local', () => {
  it('reads its own writes through app.storage.collection(name) and sends nothing', async () => {
    const { fetch, calls } = realRoutes();
    const app = await initialize({
      transport: block({ storageMode: 'local-preview' }),
      fetch,
      localPreview: { manifest: MANIFEST },
    });

    const notes = app.storage.collection<{ text: string }>('notes');
    const put = await settle(notes.put('first', { text: 'hello-7c1e' }));
    const got = await settle(notes.get('first'));

    // First, so removing the swap fails HERE, on this test's own claim.
    expect(storageCalls(calls)).toEqual([]);
    expect(calls).toEqual([]);
    expect(app.storage.mode).toBe('local-preview');
    expect(put).toMatchObject({ value: { key: 'first', version: 1 } });
    expect(got).toMatchObject({ value: { key: 'first', version: 1, data: { text: 'hello-7c1e' } } });
  });

  it('takes the manifest the Vite plugin injected when none is passed', async () => {
    (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL] = MANIFEST;
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({ transport: block({ storageMode: 'local-preview' }), fetch });

    await app.storage.collection('notes').put('k', { n: 1 });
    await expect(app.storage.collection('notes').get('k')).resolves.toMatchObject({ data: { n: 1 } });
    expect(calls).toHaveLength(0);
  });

  it('enforces the LOCAL manifest: an undeclared collection is refused locally', async () => {
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({
      transport: block({ storageMode: 'local-preview' }),
      fetch,
      localPreview: { manifest: MANIFEST },
    });

    await expect(app.storage.collection('other').put('k', { n: 1 })).rejects.toMatchObject({
      name: 'StorageError',
      code: 'collection_not_declared',
    });
    expect(calls).toHaveLength(0);
  });

  it('enforces the LOCAL manifest: no `apps:storage` declared is insufficient_scope, locally', async () => {
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({
      transport: block({ storageMode: 'local-preview' }),
      fetch,
      localPreview: { manifest: { ...MANIFEST, scopes: ['user:read:self'] } },
    });

    await expect(app.storage.collection('notes').put('k', { n: 1 })).rejects.toMatchObject({
      code: 'insufficient_scope',
    });
    expect(calls).toHaveLength(0);
  });

  it('is latched at init: the snapshot changing later does not move the store', async () => {
    const transport = block({ storageMode: 'local-preview' });
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({ transport, fetch, localPreview: { manifest: MANIFEST } });

    transport.setSnapshot({ storageMode: undefined });
    await app.storage.collection('notes').put('k', { n: 2 });

    expect(app.storage.mode).toBe('local-preview');
    expect(calls).toHaveLength(0);
  });

  it('leaves the deprecated key/value store on its real route (out of scope)', async () => {
    const { fetch, calls } = fakeFetch([() => json(200, { value: null })]);
    const app = await initialize({
      transport: block({ storageMode: 'local-preview' }),
      fetch,
      localPreview: { manifest: MANIFEST },
    });

    await app.storage.get('legacy');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/blocks/app-storage/');
  });
});

describe('dev-tunnel preview without a usable manifest', () => {
  it('fails every document-store call with a distinct LOCAL error and sends nothing', async () => {
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({ transport: block({ storageMode: 'local-preview' }), fetch });

    expect(app.storage.mode).toBe('local-preview');
    const notes = app.storage.collection('notes');
    for (const attempt of [
      () => notes.put('k', { n: 1 }),
      () => notes.get('k'),
      () => notes.list(),
      () => app.storage.info(),
    ]) {
      const error = await attempt().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toMatchObject({ code: 'local_preview_no_manifest' });
      expect((error as Error).message).toContain('blockManifestPlugin()');
    }
    expect(calls).toHaveLength(0);
  });

  it('a declaration the local store cannot serve is its own local error, and init still succeeds', async () => {
    const { fetch, calls } = fakeFetch([]);
    const app = await initialize({
      transport: block({ storageMode: 'local-preview' }),
      fetch,
      localPreview: {
        manifest: { ...MANIFEST, storage: { collections: { board: { visibility: 'shared', write: 'anyone' } } } },
      },
    });

    await expect(app.storage.collection('board').list()).rejects.toMatchObject({
      code: 'local_preview_invalid_manifest',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('without the signal: the real route, exactly as before', () => {
  it('control: the same block calls the real route once and surfaces insufficient_scope', async () => {
    const { fetch, calls } = fakeFetch([insufficientScope]);
    const app = await initialize({ transport: block(), fetch, localPreview: { manifest: MANIFEST } });

    expect(app.storage.mode).toBe('remote');
    const error = await app.storage
      .collection('notes')
      .put('first', { text: 'hello-7c1e' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({ status: 403, code: 'insufficient_scope' });
    expect(storageCalls(calls)).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: 'https://civitai.com/api/v1/blocks/storage/notes/first' });
    // The server's sentence first, then the hint; `body` untouched.
    expect((error as StorageError).message).toBe(
      `missing required scope: apps:storage — ${INSUFFICIENT_SCOPE_HINT}`,
    );
    expect((error as StorageError).body).toMatchObject({ message: 'missing required scope: apps:storage' });
  });

  it('no redirect: a token missing apps:storage with an injected manifest still hits the real route', async () => {
    // Everything the local store would need is present — the manifest via the
    // global the plugin writes — and the token lacks the scope. Only the signal is
    // missing, so nothing may switch.
    (globalThis as Record<string, unknown>)[LOCAL_PREVIEW_MANIFEST_GLOBAL] = MANIFEST;
    const { fetch, calls } = fakeFetch([insufficientScope, insufficientScope]);
    const app = await initialize({ transport: block(), fetch });

    await expect(app.storage.collection('notes').get('first')).rejects.toMatchObject({ code: 'insufficient_scope' });
    await expect(app.storage.info()).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(storageCalls(calls)).toHaveLength(2);
  });

  it('a token session (initialize({ token })) is remote too', async () => {
    const { fetch, calls } = fakeFetch([insufficientScope]);
    const app = await initialize({ token: 'oauth-token', fetch });

    expect(app.storage.mode).toBe('remote');
    await expect(app.storage.collection('notes').get('k')).rejects.toMatchObject({ code: 'insufficient_scope' });
    expect(storageCalls(calls)).toHaveLength(1);
  });
});

describe('BLOCK_INIT.storageMode on the wire', () => {
  const payload = (storageMode?: unknown): BlockInitPayload => ({
    blockInstanceId: 'inst',
    token: { raw: 't', scopes: [], expiresAt: '2031-01-01T00:00:00.000Z' },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
    ...(storageMode === undefined ? {} : { storageMode }),
  });

  it('is mirrored into the snapshot only as the exact string', () => {
    expect(snapshotFromInit(payload('local-preview'), 'https://civitai.com').storageMode).toBe('local-preview');
    for (const other of [undefined, 'remote', 'Local-Preview', 'local', true, { mode: 'local-preview' }]) {
      expect(snapshotFromInit(payload(other), 'https://civitai.com')).not.toHaveProperty('storageMode');
    }
  });
});

describe('the local store stays out of a normal bundle', () => {
  it('lands in its own chunk, loaded only by the dynamic import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sdk-local-preview-'));
    try {
      const output = (await build({
        root: dir,
        logLevel: 'silent',
        build: { write: false, minify: false, lib: { entry: resolve('src/index.ts'), formats: ['es'], fileName: 'out' } },
      })) as Rollup.RollupOutput[];
      const chunks = output.flatMap((o) => o.output).filter((c): c is Rollup.OutputChunk => c.type === 'chunk');
      // A string only `doc-store/fake.ts` holds (the default scanner's word).
      const MARKER = 'contract-blocked-term';
      const entry = chunks.filter((c) => c.isEntry);

      expect(entry).toHaveLength(1);
      expect(entry[0]!.code).not.toContain(MARKER);
      // Positive control: the marker IS bundled — in a chunk of its own.
      const lazy = chunks.filter((c) => !c.isEntry && c.code.includes(MARKER));
      expect(lazy).toHaveLength(1);
      expect(entry[0]!.dynamicImports).toContain(lazy[0]!.fileName);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
