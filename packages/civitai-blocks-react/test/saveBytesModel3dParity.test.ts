import { describe, expect, it } from 'vitest';
import { looksLikeSaveModel3d, SAVE_MODEL3D_MAX_BYTES } from '@civitai/app-sdk/save-model3d';

import { SAVE_BYTES_MODEL_3D_MAX_BYTES, startsLikeModel3d } from '../src/internal/saveBytes.js';

/**
 * The main entry restates the two 3D model rules the hook needs — the prefix test and the 100 MiB
 * cap — so it never imports `@civitai/app-sdk/save-model3d` (above the peer floor; see the note at
 * the top of src/internal/saveBytes.ts). This pins both EQUAL to the workspace app-sdk's, so a
 * drift fails here.
 */
describe('the main entry’s model rules equal @civitai/app-sdk/save-model3d', () => {
  it('the 100 MiB cap is SAVE_MODEL3D_MAX_BYTES', () => {
    expect(SAVE_BYTES_MODEL_3D_MAX_BYTES).toBe(SAVE_MODEL3D_MAX_BYTES);
    expect(SAVE_BYTES_MODEL_3D_MAX_BYTES).toBe(104_857_600);
  });

  it('startsLikeModel3d agrees with looksLikeSaveModel3d on every one-byte change of both prefixes, and on short buffers', () => {
    const enc = new TextEncoder();
    const glb = [0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 0x99];
    const fbx = [...enc.encode('Kaydara FBX Binary  '), 0x00, 0x1a, 0x00];
    let acceptedBySdk = 0;
    const disagree: string[] = [];
    for (const base of [glb, fbx]) {
      // Every truncation, then every value of every prefix byte.
      const cases: number[][] = base.map((_, n) => base.slice(0, n));
      for (let i = 0; i < 21 && i < base.length; i++) {
        for (let v = 0; v < 256; v++) cases.push(base.map((b, k) => (k === i ? v : b)));
      }
      for (const c of cases) {
        const view = new Uint8Array(c);
        const sdk = looksLikeSaveModel3d(view) !== null;
        if (sdk) acceptedBySdk++;
        if (sdk !== startsLikeModel3d(view)) disagree.push(c.slice(0, 21).join(','));
      }
    }
    expect(disagree).toEqual([]);
    // POSITIVE CONTROL: the sweep reaches both answers. GLB (9 bytes): the 8-byte truncation (1),
    // each of prefix bytes 0–7 at its own value (8), and all 256 values of the free byte 8 → 265.
    // FBX (23 bytes): the 21- and 22-byte truncations (2), each of bytes 0–20 at its own value (21)
    // → 23. Total 288.
    expect(acceptedBySdk).toBe(288);
  });
});
