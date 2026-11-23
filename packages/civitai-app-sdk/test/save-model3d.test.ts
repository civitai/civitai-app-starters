import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  isValidSaveModel3d,
  looksLikeSaveModel3d,
  SAVE_MODEL3D_EXTENSION,
  SAVE_MODEL3D_MAX_BYTES,
} from '../src/save-model3d/index.js';
import { buildFbx, buildGlb, buildLargeFbx, concatBytes, FBX_MAGIC, withU32 } from './model3dFixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(path.join(here, 'fixtures', name)));
const enc = new TextEncoder();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49]);

/** What a host does with these two functions: the type, or `null` for "not a model" / refused. */
const verdict = (u8: Uint8Array) => {
  const type = looksLikeSaveModel3d(u8);
  if (!type) return 'not-a-candidate';
  return isValidSaveModel3d(u8, type) ? type : 'refused';
};

/** A GLB chunk: length, type, data padded to 4 with `fill`. */
const chunk = (type: number, data: Uint8Array, fill = 0) => {
  const len = Math.ceil(data.length / 4) * 4;
  const out = new Uint8Array(8 + len).fill(fill, 8);
  const v = new DataView(out.buffer);
  v.setUint32(0, len, true);
  v.setUint32(4, type, true);
  out.set(data, 8);
  return out;
};
const JSON_T = 0x4e4f534a;
const BIN_T = 0x004e4942;
const EXT_T = 0x58595a57; // an extension's chunk type
/** A GLB from chunks, with a header that declares exactly their length. */
const glbOf = (...chunks: Uint8Array[]) => {
  const body = concatBytes(...chunks);
  const out = concatBytes(new Uint8Array(12), body);
  out.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  new DataView(out.buffer).setUint32(8, out.length, true);
  return out;
};
const GLTF_JSON = () => chunk(JSON_T, enc.encode('{"asset":{"version":"2.0"}}'), 0x20);

describe('save-model3d — the contract values', () => {
  it('pins the cap and the extensions', () => {
    expect(SAVE_MODEL3D_MAX_BYTES).toBe(104_857_600);
    expect(SAVE_MODEL3D_EXTENSION).toEqual({ 'model/gltf-binary': 'glb', 'model/x-fbx': 'fbx' });
  });
});

describe('save-model3d — accepted files', () => {
  it('real tool-written GLB and FBX files', () => {
    expect(verdict(fixture('tri.glb'))).toBe('model/gltf-binary');
    expect(verdict(fixture('tri.fbx'))).toBe('model/x-fbx');
  });

  it('builders: a GLB with and without BIN, FBX 7400 (32-bit records) and 7500 (64-bit)', () => {
    expect(verdict(buildGlb({ binBytes: 36 }))).toBe('model/gltf-binary');
    expect(verdict(buildGlb())).toBe('model/gltf-binary');
    expect(verdict(buildFbx())).toBe('model/x-fbx');
    expect(verdict(buildFbx({ version: 7400, bodyBytes: 12 }))).toBe('model/x-fbx');
  });

  it('checks a view at a non-zero offset into its buffer', () => {
    const glb = buildGlb({ binBytes: 8 });
    const shifted = new Uint8Array(glb.length + 16);
    shifted.set(glb, 16);
    expect(verdict(shifted.subarray(16))).toBe('model/gltf-binary');
  });

  it('a large FBX (one node spanning 60 MiB)', () => {
    expect(verdict(buildLargeFbx(60 * 1024 * 1024 + 3))).toBe('model/x-fbx');
  });
});

describe('save-model3d — GLB chunks, per glTF 2.0 §4.4.3', () => {
  // "Client implementations MUST ignore chunks with unknown types to enable glTF extensions to
  // reference additional chunks with new types following the first two chunks."
  it('accepts chunks of unknown types after JSON (+ BIN), aligned and tiling the file', () => {
    expect(verdict(glbOf(GLTF_JSON(), chunk(BIN_T, new Uint8Array(8)), chunk(EXT_T, new Uint8Array(4))))).toBe(
      'model/gltf-binary',
    );
    expect(verdict(glbOf(GLTF_JSON(), chunk(EXT_T, new Uint8Array(4)), chunk(EXT_T, new Uint8Array(0))))).toBe(
      'model/gltf-binary',
    );
  });

  it('refuses chunks out of the spec order: JSON not first, BIN not second, a second JSON', () => {
    expect(verdict(glbOf(chunk(BIN_T, new Uint8Array(8)), GLTF_JSON()))).toBe('refused');
    expect(verdict(glbOf(chunk(EXT_T, new Uint8Array(4)), GLTF_JSON()))).toBe('refused');
    expect(verdict(glbOf(GLTF_JSON(), chunk(EXT_T, new Uint8Array(4)), chunk(BIN_T, new Uint8Array(8))))).toBe(
      'refused',
    );
    expect(verdict(glbOf(GLTF_JSON(), chunk(BIN_T, new Uint8Array(8)), chunk(BIN_T, new Uint8Array(8))))).toBe(
      'refused',
    );
    expect(verdict(glbOf(GLTF_JSON(), GLTF_JSON()))).toBe('refused');
  });

  it('an unknown chunk is still held to the length rules', () => {
    // A chunk that claims more than the file holds.
    const overrun = glbOf(GLTF_JSON(), chunk(EXT_T, new Uint8Array(4)));
    expect(verdict(withU32(overrun, overrun.length - 12, 64))).toBe('refused');
    // An unaligned unknown chunk that still tiles the file: JSON 28 + 8, then 2 + 8, then 2 → 56.
    const json26 = enc.encode('{"asset":{"version":"2"}} '); // 26 bytes, valid JSON
    const unaligned = concatBytes(
      new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 56, 0, 0, 0, 26, 0, 0, 0, 0x4a, 0x53, 0x4f, 0x4e]),
      json26,
      new Uint8Array([2, 0, 0, 0, 0x57, 0x5a, 0x59, 0x58, 0, 0]),
    );
    expect(unaligned.length).toBe(56);
    expect(verdict(unaligned)).toBe('refused');
  });
});

describe('save-model3d — refused GLBs', () => {
  it('🔴 the declared length must be exactly the buffer length', () => {
    const glb = buildGlb({ binBytes: 8 });
    expect(verdict(withU32(glb, 8, glb.length + 4))).toBe('refused'); // claims more
    expect(verdict(withU32(glb, 8, glb.length - 4))).toBe('refused'); // claims less
    expect(verdict(glb.subarray(0, glb.length - 4))).toBe('refused'); // truncated
    // Anything appended — here a PNG — lies outside the declared length.
    expect(verdict(concatBytes(glb, PNG))).toBe('refused');
  });

  it('a malformed JSON chunk', () => {
    const glb = buildGlb({ binBytes: 8 });
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    expect(verdict(withU32(glb, 12, glb.length))).toBe('refused'); // overruns the file
    expect(verdict(withU32(glb, 12, jsonLen - 1))).toBe('refused'); // not a multiple of 4
    expect(verdict(buildGlb({ json: { scenes: [] } }))).toBe('refused'); // no asset
    expect(verdict(buildGlb({ json: [{ asset: { version: '2.0' } }] }))).toBe('refused'); // an array
    expect(verdict(buildGlb({ json: { asset: { version: 2 } } }))).toBe('refused'); // version not a string
  });

  it('wrong magic or container version is not a candidate at all', () => {
    const glb = buildGlb({ binBytes: 4 });
    const wrongMagic = glb.slice();
    wrongMagic[3] = 0x66; // glTf
    expect(verdict(wrongMagic)).toBe('not-a-candidate');
    expect(verdict(withU32(glb, 4, 1))).toBe('not-a-candidate'); // glTF 1.0 container
  });
});

describe('save-model3d — refused FBX files', () => {
  it('a truncated or malformed header', () => {
    const fbx = buildFbx();
    expect(verdict(fbx.subarray(0, 21))).toBe('refused');
    expect(verdict(fbx.subarray(0, 25))).toBe('refused');
    expect(verdict(concatBytes(FBX_MAGIC, new Uint8Array(8)))).toBe('refused');
    const noMarker = fbx.slice();
    noMarker[21] = 0x00;
    expect(verdict(noMarker)).toBe('refused');
  });

  it('a version outside 6100–7999 (the bounds themselves are accepted)', () => {
    const fbx = buildFbx({ version: 7400 });
    expect(verdict(withU32(fbx, 23, 6099))).toBe('refused');
    expect(verdict(withU32(fbx, 23, 6100))).toBe('model/x-fbx');
    expect(verdict(withU32(buildFbx({ version: 7500 }), 23, 7999))).toBe('model/x-fbx');
    expect(verdict(withU32(buildFbx({ version: 7500 }), 23, 8000))).toBe('refused');
    expect(verdict(withU32(fbx, 23, 5800))).toBe('refused');
  });

  it('node records that do not reach the null record, a bad name, no node, or a long tail', () => {
    expect(verdict(buildFbx().subarray(0, 60))).toBe('refused'); // cut inside the records
    expect(verdict(withU32(buildFbx(), 27, 0x7fffffff))).toBe('refused'); // end offset past the buffer
    expect(verdict(buildFbx({ names: ['Obj\u0001cts'] }))).toBe('refused'); // not printable ASCII
    expect(verdict(buildFbx({ names: [] }))).toBe('refused'); // no node
    // A second file after the footer.
    expect(verdict(buildFbx({ tail: concatBytes(new Uint8Array(160), new Uint8Array(512).fill(0x50)) }))).toBe(
      'refused',
    );
    // A short tail is fine (a writer that omits part of the footer).
    expect(verdict(buildFbx({ tail: new Uint8Array(0) }))).toBe('model/x-fbx');
  });
});

describe('save-model3d — what is not a candidate', () => {
  it('🔴 text never is: both prefixes hold a NUL byte', () => {
    expect(verdict(enc.encode('glTF is a format'))).toBe('not-a-candidate');
    expect(verdict(enc.encode('Kaydara FBX Binary  '))).toBe('not-a-candidate');
    expect(verdict(enc.encode('; FBX 7.4.0 project file'))).toBe('not-a-candidate'); // ASCII FBX
  });

  it('a PNG, and a PNG + GLB polyglot (the prefix is the PNG’s)', () => {
    expect(verdict(PNG)).toBe('not-a-candidate');
    expect(verdict(concatBytes(PNG, buildGlb({ binBytes: 16 })))).toBe('not-a-candidate');
  });

  it('reads only the first 21 bytes to decide', () => {
    const fbx = buildFbx();
    expect(looksLikeSaveModel3d(fbx.subarray(0, 21))).toBe('model/x-fbx');
    expect(looksLikeSaveModel3d(fbx.subarray(0, 20))).toBeNull();
    expect(looksLikeSaveModel3d(buildGlb().subarray(0, 8))).toBe('model/gltf-binary');
    expect(looksLikeSaveModel3d(buildGlb().subarray(0, 7))).toBeNull();
  });
});
