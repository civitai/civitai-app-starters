import { describe, expect, it } from 'vitest';

import { BridgeError, CivitaiError } from '../../src/index.js';
import { createHost } from '../../src/host/index.js';
import { createFakeTransport } from '../../src/testing.js';

const LORA = {
  versionId: 11,
  modelId: 10,
  modelName: 'Ink',
  versionName: 'v1',
  baseModel: 'SDXL 1.0',
  modelType: 'LORA',
};

describe('createFakeTransport().handle', () => {
  it('answers every call of that type from the params it was given', async () => {
    const t = createFakeTransport();
    t.handle('OPEN_RESOURCE_PICKER', (params) =>
      (params as { resourceType: string }).resourceType === 'LORA' ? { selected: LORA } : {},
    );
    const host = createHost(t);

    await expect(host.openResourcePicker({ resourceType: 'LORA' })).resolves.toEqual(LORA);
    await expect(host.openResourcePicker({ resourceType: 'Checkpoint' })).resolves.toBeNull();
  });

  it('fails the call when the handler throws', async () => {
    const t = createFakeTransport();
    t.handle('OPEN_BUZZ_PURCHASE', () => {
      throw new BridgeError('forbidden', 'OPEN_BUZZ_PURCHASE', 'review-mode');
    });

    const refused = await createHost(t).openBuzzPurchase().catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'forbidden' });
    expect(refused).toBeInstanceOf(CivitaiError);
  });

  it('lets a queued reply depart from the standing answer for one call', async () => {
    const t = createFakeTransport();
    t.handle('OPEN_BUZZ_PURCHASE', () => ({ purchased: false }));
    t.reply('OPEN_BUZZ_PURCHASE', { purchased: true });
    const host = createHost(t);

    await expect(host.openBuzzPurchase()).resolves.toEqual({ purchased: true });
    await expect(host.openBuzzPurchase()).resolves.toEqual({ purchased: false });
  });
});
