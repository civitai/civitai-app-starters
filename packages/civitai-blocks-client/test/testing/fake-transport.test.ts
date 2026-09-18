import { describe, expect, it } from 'vitest';

import { BridgeError, storage } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

describe('createFakeTransport().handle', () => {
  it('answers every call of that type from the params it was given', async () => {
    const t = createFakeTransport();
    const store = new Map([['a', 1]]);
    t.handle('APP_STORAGE_GET', (params) => ({
      value: store.get((params as { key: string }).key) ?? null,
    }));

    await expect(storage.get('a', { transport: t })).resolves.toBe(1);
    await expect(storage.get('a', { transport: t })).resolves.toBe(1);
    await expect(storage.get('b', { transport: t })).resolves.toBeNull();
  });

  it('fails the call when the handler throws', async () => {
    const t = createFakeTransport();
    t.handle('APP_STORAGE_SET', () => {
      throw new BridgeError('insufficient', 'APP_STORAGE_SET', 'per-user storage quota exceeded');
    });

    await expect(storage.set('a', 1, { transport: t })).rejects.toMatchObject({
      code: 'insufficient',
    });
  });

  it('lets a queued reply depart from the standing answer for one call', async () => {
    const t = createFakeTransport();
    t.handle('APP_STORAGE_GET', () => ({ value: 'standing' }));
    t.reply('APP_STORAGE_GET', { value: 'once' });

    await expect(storage.get('a', { transport: t })).resolves.toBe('once');
    await expect(storage.get('a', { transport: t })).resolves.toBe('standing');
  });
});
