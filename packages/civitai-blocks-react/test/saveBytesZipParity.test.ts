import { describe, expect, it } from 'vitest';
import { looksLikeSaveZip, SAVE_ZIP_MAX_BYTES } from '@civitai/app-sdk/save-zip';

import { SAVE_BYTES_ZIP_MAX_BYTES, startsLikeZip } from '../src/internal/saveBytes.js';

/**
 * The two zip rules the MAIN entry restates instead of importing (so it loads on
 * an app-sdk without `./save-zip` — see the top of src/internal/saveBytes.ts),
 * pinned EQUAL to app-sdk's own. This resolves the WORKSPACE app-sdk, so a change
 * on either side fails here in the same PR.
 */
describe('the main entry’s zip rules equal @civitai/app-sdk/save-zip', () => {
  it('the 256 MiB cap is SAVE_ZIP_MAX_BYTES', () => {
    expect(SAVE_BYTES_ZIP_MAX_BYTES).toBe(SAVE_ZIP_MAX_BYTES);
    expect(SAVE_BYTES_ZIP_MAX_BYTES).toBe(268_435_456);
  });

  it('startsLikeZip agrees with looksLikeSaveZip on every 4-byte prefix after "PK", and on short buffers', () => {
    let acceptedBySdk = 0;
    const disagree: string[] = [];
    for (const head of [
      [0x50, 0x4b],
      [0x50, 0x4c],
      [0x51, 0x4b],
    ]) {
      for (let b2 = 0; b2 < 256; b2++) {
        for (let b3 = 0; b3 < 256; b3++) {
          const view = new Uint8Array([...head, b2, b3, 0x14, 0x00]);
          const sdk = looksLikeSaveZip(view);
          if (sdk) acceptedBySdk++;
          if (sdk !== startsLikeZip(view)) disagree.push(view.slice(0, 4).join(','));
        }
      }
    }
    // POSITIVE CONTROL: the sweep reaches both answers. Exactly two prefixes are zips
    // (`PK\x03\x04` and `PK\x05\x06`); a sweep where both sides always said `false`
    // would agree everywhere and prove nothing.
    expect(acceptedBySdk).toBe(2);
    expect(disagree).toEqual([]);

    for (const short of [[], [0x50], [0x50, 0x4b], [0x50, 0x4b, 0x03], [0x50, 0x4b, 0x05]]) {
      const view = new Uint8Array(short);
      expect(startsLikeZip(view), short.join(',')).toBe(looksLikeSaveZip(view));
    }
  });
});
