import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prepareSaveBytes, saveImageRequestKind } from '../src/internal/saveBytes.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';
import type { MockHostOptions } from '../src/testing.js';

/**
 * PARITY between the mock host's `bytes` rules and the production host's
 * (civitai/civitai `src/components/AppBlocks/saveImageDownload.ts`, PR #5616
 * head 745624bc). Every row is a case from the host's own unit tests
 * (`saveImageDownload.test.ts`: `prepareSaveBytes`, `sanitizeSaveBytesFilename`,
 * `forceSaveBytesExtension`, `resolveSaveImageRequest`) or a name the round-1
 * audit named. The expected values were checked against the HOST's code run
 * directly, not derived from this package's port.
 *
 * 🔴 What this cannot prove: that the host has not changed since. It pins the
 * mock to the host as of that head; a later host change is invisible here.
 */

const ORIGIN = window.location.origin;

const ab = (...bytes: number[]) => new Uint8Array(bytes).buffer as ArrayBuffer;
const textAb = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const PNG = ab(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49);
const JPEG = ab(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46);
const WEBP = ab(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56);
const GIF = ab(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00);
const JSON_TEXT = () => textAb('{"a":1}');

type Row = {
  name: string;
  bytes: () => ArrayBuffer;
  filename: string | undefined;
  expected: { ok: true; type: string; filename: string } | { ok: false; error: string };
};

const ok = (type: string, filename: string) => ({ ok: true as const, type, filename });

// prettier-ignore
const ROWS: Row[] = [
  // host prepareSaveBytes cases
  { name: 'png keeps its name', bytes: () => PNG, filename: 'healed.png', expected: ok('image/png', 'healed.png') },
  { name: 'json named .json', bytes: JSON_TEXT, filename: 'meta.json', expected: ok('application/json', 'meta.json') },
  { name: 'json without .json is text', bytes: JSON_TEXT, filename: 'meta', expected: ok('text/plain', 'meta.txt') },
  { name: 'unnamed text', bytes: () => textAb('hello'), filename: undefined, expected: ok('text/plain', 'download.txt') },
  { name: 'traversal + .html', bytes: () => textAb('<script>x()</script>'), filename: '../../evil.html', expected: ok('text/plain', 'evil.txt') },
  { name: 'windows path + ? in name', bytes: () => JPEG, filename: 'C:\\tmp\\setup.exe?x=1', expected: ok('image/jpeg', 'setup.exe_x=1.jpg') },
  { name: 'run.json.exe', bytes: JSON_TEXT, filename: 'run.json.exe', expected: ok('text/plain', 'run.json.txt') },
  { name: 'gif refused', bytes: () => GIF, filename: 'a.gif', expected: { ok: false, error: 'file type is not allowed' } },
  // host sanitizeSaveBytesFilename → prepareSaveBytes cases (? and # are replaced, not cut)
  { name: 'issue#42.json', bytes: JSON_TEXT, filename: 'issue#42.json', expected: ok('application/json', 'issue_42.json') },
  { name: 'data.json?v=2', bytes: JSON_TEXT, filename: 'data.json?v=2', expected: ok('text/plain', 'data.json_v=2.txt') },
  { name: 'dir/../a?b#c.json', bytes: () => textAb('[1,2]'), filename: 'dir/../a?b#c.json', expected: ok('application/json', 'a_b_c.json') },
  { name: '?#', bytes: () => textAb('plain words'), filename: '?#', expected: ok('text/plain', '__.txt') },
  { name: 'n#1.md', bytes: () => textAb('seventeen bytes!!'), filename: 'n#1.md', expected: ok('text/plain', 'n_1.txt') },
  { name: 'duplicate extension collapses', bytes: () => textAb('x'), filename: 'C:\\x\\notes.txt.txt', expected: ok('text/plain', 'notes.txt') },
  { name: 'trim runs after the collapse', bytes: () => textAb('x'), filename: '  a.md.md  ', expected: ok('text/plain', 'a.md.txt') },
  { name: 'blank name', bytes: () => textAb('x'), filename: '  ', expected: ok('text/plain', 'download.txt') },
  // host forceSaveBytesExtension cases, reached through prepareSaveBytes
  { name: 'x.html', bytes: () => textAb('<b>hi</b>'), filename: 'x.html', expected: ok('text/plain', 'x.txt') },
  { name: 'x.exe as png', bytes: () => PNG, filename: 'x.exe', expected: ok('image/png', 'x.png') },
  { name: 'photo.jpeg', bytes: () => JPEG, filename: 'photo.jpeg', expected: ok('image/jpeg', 'photo.jpg') },
  { name: 'meta.data.json', bytes: JSON_TEXT, filename: 'meta.data.json', expected: ok('application/json', 'meta.data.json') },
  { name: 'render.svg as webp', bytes: () => WEBP, filename: 'render.svg', expected: ok('image/webp', 'render.webp') },
  { name: 'no extension', bytes: () => textAb('x'), filename: 'notes', expected: ok('text/plain', 'notes.txt') },
  { name: 'empty name', bytes: () => PNG, filename: '', expected: ok('image/png', 'download.png') },
  { name: 'page.xhtml', bytes: () => textAb('x'), filename: 'page.xhtml', expected: ok('text/plain', 'page.txt') },
  { name: 'bidi override (RLO)', bytes: () => textAb('x'), filename: 'inv\u202Egpj.exe', expected: ok('text/plain', 'invgpj.txt') },
  { name: 'NUL + newline in name', bytes: () => PNG, filename: 'a\u0000b\n.png', expected: ok('image/png', 'ab.png') },
  { name: 'bidi isolates', bytes: () => textAb('x'), filename: 'x\u2067gpj.exe\u2069', expected: ok('text/plain', 'xgpj.txt') },
  { name: 'LRM / ZWSP / DEL', bytes: () => textAb('x'), filename: 'a\u200eb\u200bc\u007f.txt', expected: ok('text/plain', 'abc.txt') },
  { name: '.JSON any case', bytes: JSON_TEXT, filename: 'meta.JSON', expected: ok('application/json', 'meta.json') },
  // round-1 audit names
  { name: 'notes.markdown (ext too long to replace)', bytes: () => textAb('# hi'), filename: 'notes.markdown', expected: ok('text/plain', 'notes.markdown.txt') },
  { name: '.env (no base, so no extension)', bytes: () => textAb('A=1'), filename: '.env', expected: ok('text/plain', '.env.txt') },
  { name: 'my notes.txt (spaces kept)', bytes: () => textAb('x'), filename: 'my notes.txt', expected: ok('text/plain', 'my notes.txt') },
  // classification reads the CLEANED name, BEFORE format characters are stripped
  { name: 'meta.json + ZWSP is text', bytes: JSON_TEXT, filename: 'meta.json\u200b', expected: ok('text/plain', 'meta.txt') },
  { name: 'meta.json + trailing spaces is JSON (trimmed first)', bytes: JSON_TEXT, filename: 'meta.json  ', expected: ok('application/json', 'meta.json') },
  { name: 'path ending .json is cut to its last segment', bytes: JSON_TEXT, filename: 'a.json/b', expected: ok('text/plain', 'b.txt') },
];

describe('saveBytes parity with the host (prepareSaveBytes)', () => {
  it.each(ROWS.map((r) => [r.name, r] as const))('%s', (_n, row) => {
    expect(prepareSaveBytes({ bytes: row.bytes(), filename: row.filename })).toEqual(row.expected);
  });
});

describe('saveBytes parity with the host — through createMockHost', () => {
  let uninstall: (() => void) | undefined;
  let saved: Parameters<NonNullable<MockHostOptions['onSaveBytes']>>[0][];

  beforeEach(async () => {
    saved = [];
    getTransport({ allowedParentOrigins: [ORIGIN] });
    uninstall = createMockHost({ onSaveBytes: (f) => saved.push(f) }).install();
  });
  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  it.each(ROWS.map((r) => [r.name, r] as const))('%s', async (_n, row) => {
    const payload: Record<string, unknown> = { bytes: row.bytes() };
    if (row.filename !== undefined) payload.filename = row.filename;
    const reply = (await getTransport().sendRequest(
      { type: 'SAVE_IMAGE', payload } as never,
      'SAVE_IMAGE_RESULT',
    )) as { ok?: boolean; error?: string };
    if (row.expected.ok) {
      expect(reply).toMatchObject({ ok: true });
      expect(saved).toHaveLength(1);
      expect({ type: saved[0]!.mimeType, filename: saved[0]!.filename }).toEqual({
        type: row.expected.type,
        filename: row.expected.filename,
      });
    } else {
      expect(reply).toMatchObject({ ok: false, error: row.expected.error });
      expect(saved).toHaveLength(0);
    }
  });
});

describe('request-shape parity with the host (resolveSaveImageRequest)', () => {
  // [name, payload, the host's kind]. From the host's resolveSaveImageRequest
  // tests, plus the three shapes the round-1 audit measured.
  // prettier-ignore
  const SHAPES: [string, Record<string, unknown>, 'url' | 'id' | 'bytes' | 'invalid'][] = [
    ['url', { url: 'https://image.civitai.com/x.jpeg' }, 'url'],
    ['imageId', { imageId: 55 }, 'id'],
    ['url + imageId', { url: 'https://image.civitai.com/x.jpeg', imageId: 5 }, 'invalid'],
    ['nothing', {}, 'invalid'],
    ['imageId 0', { imageId: 0 }, 'invalid'],
    ['imageId -3', { imageId: -3 }, 'invalid'],
    ['imageId 1.5', { imageId: 1.5 }, 'invalid'],
    ['bytes', { bytes: PNG }, 'bytes'],
    ['bytes + url', { bytes: PNG, url: 'https://image.civitai.com/x' }, 'invalid'],
    ['bytes + imageId', { bytes: PNG, imageId: 5 }, 'invalid'],
    ["bytes + url ''", { bytes: PNG, url: '' }, 'invalid'],
    ['bytes + imageId 0', { bytes: PNG, imageId: 0 }, 'invalid'],
    ["bytes + imageId 'x'", { bytes: PNG, imageId: 'x' }, 'invalid'],
    ["bytes + imageId '5'", { bytes: PNG, imageId: '5' }, 'invalid'],
    ['bytes Uint8Array', { bytes: new Uint8Array(PNG) }, 'invalid'],
    ['bytes DataView', { bytes: new DataView(PNG) }, 'invalid'],
    ['bytes array', { bytes: [0x89, 0x50] }, 'invalid'],
    ['bytes string', { bytes: 'PNG' }, 'invalid'],
    ['empty bytes', { bytes: new ArrayBuffer(0) }, 'invalid'],
    ['bytes null + url', { bytes: null, url: 'https://image.civitai.com/x.jpeg' }, 'url'],
    ['bytes null + imageId', { bytes: null, imageId: 7 }, 'id'],
    ['bytes undefined + url', { bytes: undefined, url: 'https://image.civitai.com/x.jpeg' }, 'url'],
  ];

  it.each(SHAPES)('%s', (_n, payload, kind) => {
    expect(saveImageRequestKind(payload)).toBe(kind);
  });
});
