import { describe, expect, it } from 'vitest';

import { media } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

describe('media.download', () => {
  it('sends an own-output url with the name to save it under', async () => {
    const t = createFakeTransport();
    t.handle('SAVE_IMAGE', () => ({ ok: true }));

    await media.download({ url: 'https://blob/out.mp4', filename: 'out.mp4' }, { transport: t });

    expect(t.sent.at(-1)).toEqual({
      type: 'SAVE_IMAGE',
      payload: { url: 'https://blob/out.mp4', filename: 'out.mp4' },
    });
  });
});
