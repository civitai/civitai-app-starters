import { describe, expect, it } from 'vitest';

import { storage } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';
import { init, mountTransport } from '../support/iframe-host.js';

const entry = (key: string) => ({ key, updatedAt: '2026-09-18T00:00:00.000Z' });

describe('storage.get', () => {
  it('returns the stored value, not the reply', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_GET', { value: { theme: 'neon' } });

    await expect(storage.get('prefs', { transport: t })).resolves.toEqual({ theme: 'neon' });
    expect(t.sent.at(-1)).toEqual({ type: 'APP_STORAGE_GET', payload: { key: 'prefs' } });
  });

  it('answers null for a key nobody wrote', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_GET', { value: null });

    await expect(storage.get('missing', { transport: t })).resolves.toBeNull();
  });

  it('reads a reply that omits the value as null', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_GET', {});

    await expect(storage.get('prefs', { transport: t })).resolves.toBeNull();
  });

  it('raises the failure the host classified', async () => {
    const t = createFakeTransport();
    t.fail('APP_STORAGE_GET', {
      code: 'forbidden',
      message: 'storage get requires the apps:storage:read scope',
    });

    await expect(storage.get('prefs', { transport: t })).rejects.toMatchObject({
      code: 'forbidden',
      operation: 'APP_STORAGE_GET',
    });
  });
});

describe('storage.set', () => {
  it('sends the key with its value', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_SET', { sizeBytes: 21 });

    await storage.set('prefs', { theme: 'neon' }, { transport: t });

    expect(t.sent.at(-1)).toEqual({
      type: 'APP_STORAGE_SET',
      payload: { key: 'prefs', value: { theme: 'neon' } },
    });
  });
});

describe('storage.remove', () => {
  it('reports whether a row actually went', async () => {
    const t = createFakeTransport();
    const store = new Set(['prefs']);
    t.handle('APP_STORAGE_DELETE', (params) => ({
      deleted: store.delete((params as { key: string }).key),
    }));

    await expect(storage.remove('prefs', { transport: t })).resolves.toBe(true);
    await expect(storage.remove('prefs', { transport: t })).resolves.toBe(false);
  });

  it('takes a host that only acknowledges the delete as nothing removed', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_DELETE', { ok: true });

    await expect(storage.remove('prefs', { transport: t })).resolves.toBe(false);
  });
});

describe('storage.list', () => {
  it('walks the pages without the cursor reaching the caller', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_LIST', { keys: [entry('a'), entry('b')], nextCursor: 'Yg==' });
    t.reply('APP_STORAGE_LIST', { keys: [entry('c')] });

    const keys: string[] = [];
    for await (const row of storage.list({ prefix: 'draft/' }, { transport: t })) keys.push(row.key);

    expect(keys).toEqual(['a', 'b', 'c']);
    expect(t.sent.map((s) => s.payload)).toEqual([
      { prefix: 'draft/', cursor: undefined },
      { prefix: 'draft/', cursor: 'Yg==' },
    ]);
  });

  it('stops fetching when the caller stops reading', async () => {
    const t = createFakeTransport();
    t.reply('APP_STORAGE_LIST', { keys: [entry('a'), entry('b')], nextCursor: 'Yg==' });

    for await (const row of storage.list({}, { transport: t })) {
      if (row.key === 'a') break;
    }

    expect(t.sent).toHaveLength(1);
  });
});

describe('storage.getQuota', () => {
  it('returns the viewer’s own allowance', async () => {
    const t = createFakeTransport();
    const quota = { usedBytes: 12_000, limitBytes: 2_097_152, rowCount: 4, limitRows: 1_000_000 };
    t.reply('APP_STORAGE_QUOTA', quota);

    await expect(storage.getQuota({ transport: t })).resolves.toEqual(quota);
  });
});

describe('storage over the wire', () => {
  it('reads a host reply that carries its fields directly', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = storage.get('prefs', { transport });
    const { requestId } = (posted.at(-1)!.msg as { payload: { requestId: string } }).payload;
    deliver({ type: 'APP_STORAGE_GET_RESULT', payload: { requestId, value: { theme: 'neon' } } });

    await expect(pending).resolves.toEqual({ theme: 'neon' });
  });

  it('raises the host’s own sentence as a classified failure', async () => {
    const { transport, posted, deliver } = mountTransport();
    deliver(init());

    const pending = storage.set('prefs', {}, { transport });
    const { requestId } = (posted.at(-1)!.msg as { payload: { requestId: string } }).payload;
    deliver({
      type: 'APP_STORAGE_SET_RESULT',
      payload: { requestId, error: 'per-user storage quota exceeded' },
    });

    await expect(pending).rejects.toMatchObject({ code: 'insufficient' });
  });
});
