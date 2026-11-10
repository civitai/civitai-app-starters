import { deflateRawSync } from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  SAVE_ZIP64_ERROR,
  SAVE_ZIP_ABSOLUTE_PATH_ERROR,
  SAVE_ZIP_ALTERNATE_PATH_ERROR,
  SAVE_ZIP_BACKSLASH_ERROR,
  SAVE_ZIP_CENTRAL_DIRECTORY_ERROR,
  SAVE_ZIP_CONTROL_CHAR_ERROR,
  SAVE_ZIP_DATA_DESCRIPTOR_ERROR,
  SAVE_ZIP_DIRECTORY_DATA_ERROR,
  SAVE_ZIP_DRIVE_OR_COLON_ERROR,
  SAVE_ZIP_DUPLICATE_NAME_ERROR,
  SAVE_ZIP_EMPTY_ERROR,
  SAVE_ZIP_EMPTY_SEGMENT_ERROR,
  SAVE_ZIP_ENCRYPTED_ERROR,
  SAVE_ZIP_EXTRA_FIELD_ERROR,
  SAVE_ZIP_FLAGS_ERROR,
  SAVE_ZIP_HEADER_MISMATCH_ERROR,
  SAVE_ZIP_INFLATE_ERROR,
  SAVE_ZIP_LAYOUT_ERROR,
  SAVE_ZIP_LIMITS,
  SAVE_ZIP_LOCAL_HEADER_ERROR,
  SAVE_ZIP_MAX_BYTES,
  SAVE_ZIP_MULTIDISK_ERROR,
  SAVE_ZIP_NAME_ENCODING_ERROR,
  SAVE_ZIP_NO_EOCD_ERROR,
  SAVE_ZIP_PATH_CONFLICT_ERROR,
  SAVE_ZIP_RATIO_ERROR,
  SAVE_ZIP_SPECIAL_FILE_ERROR,
  SAVE_ZIP_STORED_SIZE_ERROR,
  SAVE_ZIP_TOO_MANY_ENTRIES_ERROR,
  SAVE_ZIP_TOTAL_SIZE_ERROR,
  SAVE_ZIP_TRAVERSAL_ERROR,
  SAVE_ZIP_TRUNCATED_ERROR,
  saveZipEntryTypeError,
  saveZipMethodError,
  validateSaveZip,
  verifySaveZipInflate,
} from '../src/save-zip/index.js';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
//
// Two sources, on purpose: REAL zips written by jszip (what an app author's code produces), and a
// raw byte-level builder for the malicious shapes jszip will not write. The builder's own baseline
// is asserted VALID first (positive control), so every refusal below is a refusal of the one field
// the case changes, not of a builder bug.

const MB = 1024 * 1024;
const enc = new TextEncoder();
const bytesOf = (s: string | Uint8Array) => (typeof s === 'string' ? enc.encode(s) : s);
// A real PNG signature + IHDR start, so a sniffer that only checks length can't pass.
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49];

type Raw = {
  name: string | Uint8Array;
  localName?: string | Uint8Array;
  /** The bytes written as the entry's (compressed) data. */
  data?: Uint8Array;
  method?: number;
  localMethod?: number;
  flags?: number;
  localFlags?: number;
  crc?: number;
  /** Declared uncompressed size (central directory). Defaults to data.length. */
  size?: number;
  /** Declared compressed size (central directory). Defaults to data.length. */
  compressedSize?: number;
  /** Local-header crc / sizes; default = the central values (zeros when a descriptor is used). */
  local?: { crc?: number; compressedSize?: number; size?: number };
  descriptor?: 'sig' | 'nosig';
  /** The 4-byte value written where a 'sig' descriptor's signature goes. */
  descriptorSig?: number;
  /** The central record's "disk number start". */
  diskStart?: number;
  descriptorValues?: { crc: number; compressedSize: number; size: number };
  extra?: Uint8Array;
  localExtra?: Uint8Array;
  externalAttrs?: number;
  /** Override the central directory's recorded local-header offset. */
  localOffset?: number;
  /** Bytes written after this entry's data (before the next local header). */
  after?: Uint8Array;
};

type Opts = {
  prefix?: Uint8Array;
  beforeCd?: Uint8Array;
  trailing?: Uint8Array;
  comment?: Uint8Array;
  beforeEocd?: Uint8Array;
  eocd?: Partial<{
    disk: number;
    cdDisk: number;
    entriesOnDisk: number;
    totalEntries: number;
    cdSize: number;
    cdOffset: number;
    /** The comment length the EOCD DECLARES (default: the real comment's). */
    commentLen: number;
  }>;
};

class W {
  private parts: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u16(v: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    this.bytes(b);
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.bytes(b);
  }
  out(): ArrayBuffer {
    const u8 = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      u8.set(p, o);
      o += p.length;
    }
    return u8.buffer;
  }
}

function buildZip(entries: Raw[], opts: Opts = {}): ArrayBuffer {
  const w = new W();
  if (opts.prefix) w.bytes(opts.prefix);
  const offsets: number[] = [];
  for (const e of entries) {
    const data = e.data ?? new Uint8Array(0);
    const name = bytesOf(e.name);
    const localName = e.localName != null ? bytesOf(e.localName) : name;
    const flags = e.flags ?? (e.descriptor ? 1 << 3 : 0);
    const crc = e.crc ?? 0x1234abcd;
    const csize = e.compressedSize ?? data.length;
    const usize = e.size ?? data.length;
    const zeroLocal = e.descriptor != null;
    const localExtra = e.localExtra ?? new Uint8Array(0);
    offsets.push(w.length);
    w.u32(0x04034b50);
    w.u16(20);
    w.u16(e.localFlags ?? flags);
    w.u16(e.localMethod ?? e.method ?? 0);
    w.u16(0);
    w.u16(0x21);
    w.u32(e.local?.crc ?? (zeroLocal ? 0 : crc));
    w.u32(e.local?.compressedSize ?? (zeroLocal ? 0 : csize));
    w.u32(e.local?.size ?? (zeroLocal ? 0 : usize));
    w.u16(localName.length);
    w.u16(localExtra.length);
    w.bytes(localName);
    w.bytes(localExtra);
    w.bytes(data);
    if (e.descriptor) {
      const d = e.descriptorValues ?? { crc, compressedSize: csize, size: usize };
      if (e.descriptor === 'sig') w.u32(e.descriptorSig ?? 0x08074b50);
      w.u32(d.crc);
      w.u32(d.compressedSize);
      w.u32(d.size);
    }
    if (e.after) w.bytes(e.after);
  }
  if (opts.beforeCd) w.bytes(opts.beforeCd);
  const cdOffset = w.length;
  entries.forEach((e, i) => {
    const data = e.data ?? new Uint8Array(0);
    const name = bytesOf(e.name);
    const extra = e.extra ?? new Uint8Array(0);
    w.u32(0x02014b50);
    w.u16(20);
    w.u16(20);
    w.u16(e.flags ?? (e.descriptor ? 1 << 3 : 0));
    w.u16(e.method ?? 0);
    w.u16(0);
    w.u16(0x21);
    w.u32(e.crc ?? 0x1234abcd);
    w.u32(e.compressedSize ?? data.length);
    w.u32(e.size ?? data.length);
    w.u16(name.length);
    w.u16(extra.length);
    w.u16(0);
    w.u16(e.diskStart ?? 0);
    w.u16(0);
    w.u32(e.externalAttrs ?? 0);
    w.u32(e.localOffset ?? offsets[i]);
    w.bytes(name);
    w.bytes(extra);
  });
  const cdSize = w.length - cdOffset;
  if (opts.beforeEocd) w.bytes(opts.beforeEocd);
  const comment = opts.comment ?? new Uint8Array(0);
  w.u32(0x06054b50);
  w.u16(opts.eocd?.disk ?? 0);
  w.u16(opts.eocd?.cdDisk ?? 0);
  w.u16(opts.eocd?.entriesOnDisk ?? entries.length);
  w.u16(opts.eocd?.totalEntries ?? entries.length);
  w.u32(opts.eocd?.cdSize ?? cdSize);
  w.u32(opts.eocd?.cdOffset ?? cdOffset);
  w.u16(opts.eocd?.commentLen ?? comment.length);
  w.bytes(comment);
  if (opts.trailing) w.bytes(opts.trailing);
  return w.out();
}

const extraField = (id: number, body: number[] = [0, 0, 0, 0]) => {
  const u8 = new Uint8Array(4 + body.length);
  const v = new DataView(u8.buffer);
  v.setUint16(0, id, true);
  v.setUint16(2, body.length, true);
  u8.set(body, 4);
  return u8;
};

const file = (name: string, content = 'caption text') => ({ name, data: enc.encode(content) });
const deflated = (name: string, content: Uint8Array) => {
  const data = new Uint8Array(deflateRawSync(content));
  return { name, method: 8, data, size: content.length };
};

/** Rewrite a single-entry zip's declared uncompressed size in BOTH headers (a consistent lie). */
function lieAboutSize(zip: ArrayBuffer, size: number): ArrayBuffer {
  const copy = zip.slice(0);
  const v = new DataView(copy);
  const eocd = copy.byteLength - 22;
  const cd = v.getUint32(eocd + 16, true);
  v.setUint32(22, size, true);
  v.setUint32(cd + 24, size, true);
  return copy;
}

const jszip = async (
  files: Record<string, string | Uint8Array | null>,
  options: { compression?: 'STORE' | 'DEFLATE'; streamFiles?: boolean; comment?: string } = {}
) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    if (content === null) zip.folder(name);
    else zip.file(name, content);
  }
  const u8 = await zip.generateAsync({
    type: 'uint8array',
    compression: options.compression ?? 'STORE',
    streamFiles: options.streamFiles ?? false,
    ...(options.comment !== undefined ? { comment: options.comment } : {}),
  });
  return u8.slice().buffer;
};

// CRC-32 (IEEE), written here independently of the validator so a fixture's checksum is not the
// implementation grading itself. Cross-checked against the CRC jszip writes, below.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** An Info-ZIP Unicode Path extra field (0x7075): version, CRC-32 of the header name, UTF-8 name. */
const unicodePath = (
  name: string,
  opts: { headerName?: string; version?: number; crc?: number } = {}
) => {
  const u = enc.encode(name);
  const body = new Uint8Array(5 + u.length);
  const v = new DataView(body.buffer);
  v.setUint8(0, opts.version ?? 1);
  v.setUint32(1, opts.crc ?? crc32(enc.encode(opts.headerName ?? name)), true);
  body.set(u, 5);
  return extraField(0x7075, [...body]);
};

/**
 * The extra fields of a ONE-entry zip's local and central headers: `[id, offset, size]` each.
 * (No folder in the name: jszip adds a separate entry for every parent folder.)
 */
function singleEntryExtras(zip: ArrayBuffer) {
  const v = new DataView(zip);
  const cd = v.getUint32(zip.byteLength - 22 + 16, true);
  const walk = (start: number, len: number) => {
    const out: [id: number, offset: number, size: number][] = [];
    for (let p = start; p < start + len; ) {
      const size = v.getUint16(p + 2, true);
      out.push([v.getUint16(p, true), p + 4, size]);
      p += 4 + size;
    }
    return out;
  };
  return {
    local: walk(30 + v.getUint16(26, true), v.getUint16(28, true)),
    central: walk(cd + 46 + v.getUint16(cd + 28, true), v.getUint16(cd + 30, true)),
  };
}

const refusal = (bytes: ArrayBuffer) => {
  const r = validateSaveZip(bytes);
  return r.ok ? 'ok' : r.error;
};

const DATASET = {
  'images/001.png': new Uint8Array([...PNG_HEAD, 1, 2, 3]),
  'images/002.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]),
  'images/003.jpeg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7]),
  'images/004.webp': enc.encode('RIFF....WEBPVP8 '),
  'images/001.txt': 'a cat, sitting, sunlight',
  'images/002.TXT': 'a dog',
  'meta.json': '{"trigger":"my-dataset"}',
  'tags.csv': 'file,tags\n001.png,cat\n',
};

// ── Real zips (jszip) ───────────────────────────────────────────────────────────────────────────

describe('validateSaveZip — real zips written by jszip', () => {
  it('accepts a STORED image + caption dataset with folders', async () => {
    const zip = await jszip({ ...DATASET, 'images/': null, 'empty/': null });
    expect(validateSaveZip(zip)).toEqual({ ok: true, entryCount: 10, deflated: [] });
  });

  it('accepts a DEFLATE dataset and lists every deflated entry for the inflate check', async () => {
    const zip = await jszip(DATASET, { compression: 'DEFLATE' });
    const r = validateSaveZip(zip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 8 files + the 'images/' folder jszip adds for them (stored, so not in `deflated`).
    expect(r.entryCount).toBe(9);
    expect(r.deflated).toHaveLength(8);
    expect(await verifySaveZipInflate(zip, r.deflated)).toBeNull();
  });

  it('accepts data-descriptor zips (jszip streamFiles), stored and deflated', async () => {
    for (const compression of ['STORE', 'DEFLATE'] as const) {
      const zip = await jszip(DATASET, { compression, streamFiles: true });
      expect(refusal(zip)).toBe('ok');
    }
  });

  it('refuses an empty archive', async () => {
    expect(refusal(await jszip({}))).toBe(SAVE_ZIP_EMPTY_ERROR);
  });

  it('refuses a REAL deflate bomb by its declared ratio, before inflating anything', async () => {
    // 8 MB of one byte deflates to a few KB: a ratio far over 100.
    const zip = await jszip({ 'bomb.txt': 'A'.repeat(8 * MB) }, { compression: 'DEFLATE' });
    expect(zip.byteLength).toBeLessThan(64 * 1024);
    expect(refusal(zip)).toBe(SAVE_ZIP_RATIO_ERROR);
  });

  it.each([
    ['payload.exe', 'exe'],
    ['index.html', 'html'],
    ['icon.svg', 'svg'],
    ['inner.zip', 'zip'],
    ['nested/archive.7z', '7z'],
    ['photo.png.exe', 'exe'],
    ['run.sh', 'sh'],
    ['README', ''],
    ['trailing-dot.png.', ''],
  ])('refuses a %s entry (allowlist): %s', async (name, ext) => {
    const zip = await jszip({ 'ok.png': new Uint8Array(PNG_HEAD), [name]: 'x' });
    expect(refusal(zip)).toBe(saveZipEntryTypeError(ext));
  });
});

// ── Real zips with non-ASCII names, and archive comments (jszip) ──────────────────────────────

describe('validateSaveZip — real jszip zips with non-ASCII entry names', () => {
  const NAMES = ['img/café.png', '画像/001.png', 'captions/naïve ✓.txt', 'données/été 2026.json'];

  it('POSITIVE CONTROL: jszip writes a Unicode Path field (0x7075) in BOTH headers for a non-ASCII name, and none for ASCII', async () => {
    const extras = singleEntryExtras(await jszip({ 'café.png': new Uint8Array(PNG_HEAD) }));
    expect(extras.local.map(([id]) => id)).toEqual([0x7075]);
    expect(extras.central.map(([id]) => id)).toEqual([0x7075]);
    const ascii = singleEntryExtras(await jszip({ 'cafe.png': new Uint8Array(PNG_HEAD) }));
    expect([...ascii.local, ...ascii.central]).toEqual([]);
  });

  it('POSITIVE CONTROL: the field jszip writes is exactly version 1 + CRC-32 of the header name + the same UTF-8 name', async () => {
    const zip = await jszip({ 'café.png': new Uint8Array(PNG_HEAD) });
    const v = new DataView(zip);
    const [, offset, size] = singleEntryExtras(zip).central[0]!;
    const name = enc.encode('café.png');
    expect(v.getUint8(offset)).toBe(1);
    // Also the cross-check of this file's own crc32 against a CRC a real writer computed.
    expect(v.getUint32(offset + 1, true)).toBe(crc32(name));
    expect(new Uint8Array(zip, offset + 5, size - 5)).toEqual(name);
    // And the entry sets the UTF-8 flag.
    expect(v.getUint16(6, true) & (1 << 11)).toBe(1 << 11);
  });

  it.each(NAMES)('accepts %j — stored, deflated, and streamed', async (name) => {
    for (const options of [
      { compression: 'STORE' as const },
      { compression: 'DEFLATE' as const },
      { compression: 'DEFLATE' as const, streamFiles: true },
    ]) {
      const zip = await jszip({ [name]: name.endsWith('.png') ? new Uint8Array(PNG_HEAD) : 'a caption' }, options);
      const r = validateSaveZip(zip);
      expect(r, JSON.stringify(options)).toMatchObject({ ok: true });
      if (r.ok) expect(await verifySaveZipInflate(zip, r.deflated)).toBeNull();
    }
  });

  it('accepts a whole captioned dataset with non-ASCII folders and names', async () => {
    const zip = await jszip(
      {
        '画像/001.png': new Uint8Array(PNG_HEAD),
        '画像/001.txt': '猫、座っている',
        'images/café.png': new Uint8Array(PNG_HEAD),
        'images/café.txt': 'a café terrace',
        'méta.json': '{"trigger":"ç"}',
      },
      { compression: 'DEFLATE' }
    );
    const r = validateSaveZip(zip);
    // 5 files + the two folders jszip adds for them.
    expect(r).toMatchObject({ ok: true, entryCount: 7 });
    if (r.ok) expect(await verifySaveZipInflate(zip, r.deflated)).toBeNull();
  });

  it('refuses a REAL jszip zip whose Unicode Path field was rewritten to another name of the same length', async () => {
    // One byte of the central header's UnicodeName changed (é → è is 0xa9 → 0xa8): the CRC still
    // matches the header name, the version is 1, so only the name comparison can refuse it.
    const zip = await jszip({ 'café.png': new Uint8Array(PNG_HEAD) });
    const [, offset, size] = singleEntryExtras(zip).central[0]!;
    const u8 = new Uint8Array(zip);
    const at = offset + size - 5; // the second byte of `é`, five bytes before the end (`.png`)
    expect(u8[at]).toBe(0xa9);
    u8[at] = 0xa8;
    expect(refusal(zip)).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
  });
});

describe('validateSaveZip — archive comments', () => {
  // DECIDED: still refused, bounded or not. The validator pins the EOCD to the last 22 bytes,
  // which is what makes "nothing after the central directory" checkable at all; with a comment the
  // EOCD has to be FOUND by scanning backwards for its signature, and the comment can itself
  // contain a second EOCD-shaped record — the classic way two readers end up seeing two different
  // archives. A comment is also displayed (`unzip -z`, archive-manager panes) and so is a terminal-
  // escape surface. A dataset needs neither; jszip only writes one when `comment` is passed.
  it('refuses a REAL jszip archive comment, and accepts the same zip without one (control)', async () => {
    const files = { 'images/001.png': new Uint8Array(PNG_HEAD), 'images/001.txt': 'a cat' };
    expect(refusal(await jszip(files))).toBe('ok');
    const commented = await jszip(files, { comment: 'dataset v1' });
    expect(new DataView(commented).getUint16(commented.byteLength - 'dataset v1'.length - 2, true)).toBe(
      'dataset v1'.length
    );
    expect(refusal(commented)).toBe(SAVE_ZIP_NO_EOCD_ERROR);
  });
});

// ── Raw builder: positive control first ─────────────────────────────────────────────────────────

describe('validateSaveZip — hand-built zips', () => {
  it('POSITIVE CONTROL: the builder baseline is valid (stored, deflated, both descriptor forms)', () => {
    expect(refusal(buildZip([file('a.txt')]))).toBe('ok');
    expect(refusal(buildZip([file('a.txt'), file('dir/b.json', '{}'), { name: 'dir/' }]))).toBe(
      'ok'
    );
    expect(refusal(buildZip([deflated('c.csv', enc.encode('x,y\n'.repeat(50)))]))).toBe('ok');
    expect(refusal(buildZip([{ ...file('d.txt'), descriptor: 'sig' }]))).toBe('ok');
    expect(refusal(buildZip([{ ...file('e.txt'), descriptor: 'nosig' }, file('f.txt')]))).toBe(
      'ok'
    );
    // Unix mode bits for a regular file and a directory are fine.
    expect(
      refusal(
        buildZip([
          { ...file('g.txt'), externalAttrs: (0o100644 << 16) >>> 0 },
          { name: 'h/', externalAttrs: (0o040755 << 16) >>> 0 },
        ])
      )
    ).toBe('ok');
  });

  describe('names', () => {
    it.each([
      ['../evil.txt', SAVE_ZIP_TRAVERSAL_ERROR],
      ['a/../../evil.txt', SAVE_ZIP_TRAVERSAL_ERROR],
      ['a/b/../c.txt', SAVE_ZIP_TRAVERSAL_ERROR],
      ['/etc/cron.d/x.txt', SAVE_ZIP_ABSOLUTE_PATH_ERROR],
      ['..\\evil.txt', SAVE_ZIP_BACKSLASH_ERROR],
      ['a\\b.txt', SAVE_ZIP_BACKSLASH_ERROR],
      ['C:/Windows/x.txt', SAVE_ZIP_DRIVE_OR_COLON_ERROR],
      ['C:x.txt', SAVE_ZIP_DRIVE_OR_COLON_ERROR],
      ['notes.txt:hidden.exe', SAVE_ZIP_DRIVE_OR_COLON_ERROR],
      ['a//b.txt', SAVE_ZIP_EMPTY_SEGMENT_ERROR],
      ['./a.txt', SAVE_ZIP_EMPTY_SEGMENT_ERROR],
      ['a/./b.txt', SAVE_ZIP_EMPTY_SEGMENT_ERROR],
      ['cap\u0000tion.txt', SAVE_ZIP_CONTROL_CHAR_ERROR],
      ['line\nbreak.txt', SAVE_ZIP_CONTROL_CHAR_ERROR],
      ['inv\u202Etxt.exe', SAVE_ZIP_CONTROL_CHAR_ERROR],
      ['zero\u200Bwidth.png', SAVE_ZIP_CONTROL_CHAR_ERROR],
      ['iso\u2067x\u2069.txt', SAVE_ZIP_CONTROL_CHAR_ERROR],
    ])('refuses %j', (name, error) => {
      // UTF-8 flag set so the non-ASCII cases reach the name rules, not the encoding rule.
      expect(refusal(buildZip([file('ok.txt'), { ...file('x'), name, flags: 1 << 11 }]))).toBe(
        error
      );
    });

    it('refuses a non-ASCII name without the UTF-8 flag, and invalid UTF-8 with it', () => {
      const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x74, 0x78, 0x74]); // café.txt
      expect(refusal(buildZip([{ ...file('x'), name: latin1 }]))).toBe(
        SAVE_ZIP_NAME_ENCODING_ERROR
      );
      expect(refusal(buildZip([{ ...file('x'), name: latin1, flags: 1 << 11 }]))).toBe(
        SAVE_ZIP_NAME_ENCODING_ERROR
      );
      // A real UTF-8 name with the flag is accepted.
      expect(refusal(buildZip([{ ...file('x'), name: 'café.txt', flags: 1 << 11 }]))).toBe('ok');
    });

    it('refuses duplicate names — exact, case-insensitive, NFC/NFD, and file vs directory', () => {
      expect(refusal(buildZip([file('a.txt'), file('a.txt')]))).toBe(SAVE_ZIP_DUPLICATE_NAME_ERROR);
      expect(refusal(buildZip([file('IMG.png'), file('img.PNG')]))).toBe(
        SAVE_ZIP_DUPLICATE_NAME_ERROR
      );
      const nfc = '\u00e9.txt';
      const nfd = 'e\u0301.txt';
      expect(
        refusal(
          buildZip([
            { ...file('x'), name: nfc, flags: 1 << 11 },
            { ...file('x'), name: nfd, flags: 1 << 11 },
          ])
        )
      ).toBe(SAVE_ZIP_DUPLICATE_NAME_ERROR);
      expect(refusal(buildZip([{ name: 'x.txt/' }, file('x.txt')]))).toBe(
        SAVE_ZIP_DUPLICATE_NAME_ERROR
      );
    });

    it('refuses an entry under a path another entry claims as a file', () => {
      expect(refusal(buildZip([file('a.txt'), file('a.txt/b.txt')]))).toBe(
        SAVE_ZIP_PATH_CONFLICT_ERROR
      );
      expect(refusal(buildZip([file('d/a.txt/b/c.txt'), file('D/A.TXT')]))).toBe(
        SAVE_ZIP_PATH_CONFLICT_ERROR
      );
    });

    it('refuses an Info-ZIP Unicode Path extra field that is malformed or names ANOTHER path', () => {
      // The field is how an extractor may pick a name other than the header's, so only the exact
      // shape jszip writes is accepted (the next describe). Each case below changes ONE thing from
      // that shape — the POSITIVE CONTROL first, so a refusal is the changed field, not the builder.
      const U = 1 << 11;
      const named = (name: string, extra: Uint8Array, flags = U) => ({ ...file('x'), name, flags, extra, localExtra: extra });
      expect(refusal(buildZip([named('café.txt', unicodePath('café.txt'))]))).toBe('ok');
      // The smuggling shape: an allowed header name, an alternate path to something else. The CRC
      // is the HEADER name's, so only the name comparison can refuse it.
      expect(refusal(buildZip([named('a.txt', unicodePath('../evil.exe', { headerName: 'a.txt' }))]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      // Same, in ONE header only (central, then local): each header's field is checked.
      const evil = unicodePath('../evil.exe', { headerName: 'a.txt' });
      const good = unicodePath('a.txt');
      expect(refusal(buildZip([named('a.txt', good)]))).toBe('ok');
      expect(refusal(buildZip([{ ...named('a.txt', good), extra: evil }]))).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
      expect(refusal(buildZip([{ ...named('a.txt', good), localExtra: evil }]))).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
      // A same-length different name (é vs è): byte-exact, not "close enough".
      expect(refusal(buildZip([named('café.txt', unicodePath('cafè.txt', { headerName: 'café.txt' }))]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      // The right name with a wrong CRC, a version other than 1, or a body too short to hold one.
      expect(refusal(buildZip([named('café.txt', unicodePath('café.txt', { crc: 0x12345678 }))]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      expect(refusal(buildZip([named('café.txt', unicodePath('café.txt', { version: 2 }))]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      expect(refusal(buildZip([named('a.txt', extraField(0x7075, [1, 0, 0, 0]))]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      // An empty (size 0) field must not be read PAST: here the bytes after it — the next extra
      // field's header — happen to spell version 1 and this name's CRC (`f1918.txt` was picked for
      // that: CRC-32 0x400026f7, so the next field is id 0xf701, size 38, data starting 0x40). A
      // reader that ignores the size would accept the version and CRC and then fail on the body.
      expect([...new Uint8Array(new Uint32Array([crc32(enc.encode('f1918.txt'))]).buffer)]).toEqual([0xf7, 0x26, 0x00, 0x40]);
      const overread = new Uint8Array([...extraField(0x7075, []), ...extraField(0xf701, [0x40, ...new Array(37).fill(0)])]);
      expect(refusal(buildZip([{ ...file('x'), name: 'f1918.txt', flags: U, extra: overread }]))).toBe(
        SAVE_ZIP_ALTERNATE_PATH_ERROR
      );
      // A field naming a PREFIX of the header name: `payload.exe` inside a header that says
      // `payload.exe.txt`. Equal byte for byte as far as it goes, so only the length refuses it.
      expect(
        refusal(buildZip([named('payload.exe.txt', unicodePath('payload.exe', { headerName: 'payload.exe.txt' }))]))
      ).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
      // A matching field on an entry WITHOUT the UTF-8 flag (an ASCII name, so the encoding rule
      // passes it): the field then claims a different encoding than the header does.
      expect(refusal(buildZip([named('a.txt', unicodePath('a.txt'), 0)]))).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
      // The original shape: a stray field on a flagless entry naming `..`.
      const alt = extraField(0x7075, [1, 0, 0, 0, 0, 0x2e, 0x2e]);
      expect(refusal(buildZip([{ ...file('a.txt'), extra: alt }]))).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), localExtra: alt }]))).toBe(SAVE_ZIP_ALTERNATE_PATH_ERROR);
    });
  });

  describe('entry kinds', () => {
    it('refuses a symlink and other special files by their Unix mode', () => {
      for (const mode of [0o120777, 0o060644, 0o020644, 0o010644, 0o140755]) {
        expect(
          refusal(
            buildZip([{ ...file('link.txt', '/etc/passwd'), externalAttrs: (mode << 16) >>> 0 }])
          )
        ).toBe(SAVE_ZIP_SPECIAL_FILE_ERROR);
      }
    });

    it('refuses a directory entry that carries data', () => {
      expect(refusal(buildZip([{ name: 'dir/', data: enc.encode('hidden') }]))).toBe(
        SAVE_ZIP_DIRECTORY_DATA_ERROR
      );
    });

    it('refuses encrypted entries: the flag bits and the encryption extra fields', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), flags: 1 }]))).toBe(SAVE_ZIP_ENCRYPTED_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), flags: 1 << 6 }]))).toBe(
        SAVE_ZIP_ENCRYPTED_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), flags: 1 << 13 }]))).toBe(
        SAVE_ZIP_ENCRYPTED_ERROR
      );
      expect(
        refusal(
          buildZip([{ ...file('a.txt'), extra: extraField(0x9901, [2, 0, 0x41, 0x45, 3, 8, 0]) }])
        )
      ).toBe(SAVE_ZIP_ENCRYPTED_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), extra: extraField(0x0017) }]))).toBe(
        SAVE_ZIP_ENCRYPTED_ERROR
      );
    });

    it('refuses an unknown general-purpose flag bit', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), flags: 1 << 5 }]))).toBe(SAVE_ZIP_FLAGS_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), flags: 1 << 12 }]))).toBe(SAVE_ZIP_FLAGS_ERROR);
    });

    it.each([1, 6, 9, 12, 14, 93, 95, 98, 99])('refuses compression method %i', (method) => {
      expect(refusal(buildZip([{ ...file('a.txt'), method }]))).toBe(saveZipMethodError(method));
    });

    it('refuses a stored entry whose sizes disagree', () => {
      expect(refusal(buildZip([{ ...file('a.txt', 'abc'), size: 7 }]))).toBe(
        SAVE_ZIP_STORED_SIZE_ERROR
      );
    });
  });

  describe('central directory vs local headers', () => {
    it('refuses a local name that differs from the central-directory name', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), localName: 'a.exe' }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      // Same length, one byte different — and a different LENGTH.
      expect(refusal(buildZip([{ ...file('caption.txt'), localName: '../pwn.txt' }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), localName: 'a.txt.exe' }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
    });

    it('refuses a local method, flags, CRC or size that differs', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), localMethod: 8 }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), localFlags: 1 << 11 }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), local: { crc: 0xdeadbeef } }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), local: { size: 3 } }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), local: { compressedSize: 3 } }]))).toBe(
        SAVE_ZIP_HEADER_MISMATCH_ERROR
      );
    });

    it('refuses a zeroed local header when the entry declares no data descriptor', () => {
      // Zeros are only legitimate when bit 3 says the real values follow the data.
      expect(
        refusal(buildZip([{ ...file('a.txt'), local: { crc: 0, compressedSize: 0, size: 0 } }]))
      ).toBe(SAVE_ZIP_HEADER_MISMATCH_ERROR);
    });

    it('refuses a data descriptor that disagrees, or one of the wrong length', () => {
      const e = { ...file('a.txt', 'abcd'), descriptor: 'sig' as const };
      expect(
        refusal(
          buildZip([{ ...e, descriptorValues: { crc: 0x1234abcd, compressedSize: 4, size: 5 } }])
        )
      ).toBe(SAVE_ZIP_DATA_DESCRIPTOR_ERROR);
      // zip64-shaped descriptor tail: 4 extra bytes after a valid one.
      expect(refusal(buildZip([{ ...e, after: new Uint8Array(4) }]))).toBe(
        SAVE_ZIP_DATA_DESCRIPTOR_ERROR
      );
      // A 16-byte descriptor whose signature is wrong (the 12 value bytes after it are right).
      expect(refusal(buildZip([{ ...e, descriptorSig: 0xdeadbeef }]))).toBe(
        SAVE_ZIP_DATA_DESCRIPTOR_ERROR
      );
      // 20 bytes: a correct 12-byte descriptor followed by 8 more (a zip64 descriptor's length).
      expect(refusal(buildZip([{ ...e, descriptor: 'nosig', after: new Uint8Array(8) }]))).toBe(
        SAVE_ZIP_DATA_DESCRIPTOR_ERROR
      );
      // 16 bytes without the signature.
      expect(refusal(buildZip([{ ...e, descriptor: 'nosig', after: new Uint8Array(4) }]))).toBe(
        SAVE_ZIP_DATA_DESCRIPTOR_ERROR
      );
    });

    it('refuses a corrupted local-header signature', () => {
      const zip = buildZip([file('a.txt'), file('b.txt')]);
      const second = 30 + 5 + 'caption text'.length;
      new DataView(zip).setUint32(second, 0x04034b51, true);
      expect(refusal(zip)).toBe(SAVE_ZIP_LOCAL_HEADER_ERROR);
    });

    it('refuses a SMUGGLED local entry the central directory does not list (polyglot)', () => {
      // A reader walking local headers sees `evil.exe`; one reading the directory does not.
      const hidden = new Uint8Array(buildZip([file('evil.exe', 'MZ')]).slice(0, 30 + 8 + 2));
      expect(refusal(buildZip([{ ...file('a.txt'), after: hidden }, file('b.txt')]))).toBe(
        SAVE_ZIP_LAYOUT_ERROR
      );
      expect(refusal(buildZip([file('a.txt')], { beforeCd: hidden }))).toBe(SAVE_ZIP_LAYOUT_ERROR);
    });

    it('refuses two directory records pointing at ONE local header', () => {
      expect(refusal(buildZip([file('a.txt'), { ...file('a2.txt'), localOffset: 0 }]))).toBe(
        SAVE_ZIP_LAYOUT_ERROR
      );
    });
  });

  describe('archive structure', () => {
    it('refuses trailing data, an archive comment, and a missing EOCD', () => {
      expect(refusal(buildZip([file('a.txt')], { trailing: enc.encode('junk') }))).toBe(
        SAVE_ZIP_NO_EOCD_ERROR
      );
      expect(refusal(buildZip([file('a.txt')], { comment: enc.encode('hello') }))).toBe(
        SAVE_ZIP_NO_EOCD_ERROR
      );
      const zip = buildZip([file('a.txt')]);
      expect(refusal(zip.slice(0, zip.byteLength - 1))).toBe(SAVE_ZIP_NO_EOCD_ERROR);
    });

    it('refuses a buffer too short to hold an EOCD', () => {
      expect(refusal(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]).buffer)).toBe(
        SAVE_ZIP_TRUNCATED_ERROR
      );
    });

    it('refuses an EOCD that declares a comment which is not there', () => {
      // The last 22 bytes ARE an EOCD, so only the comment-length rule can refuse it.
      expect(refusal(buildZip([file('a.txt')], { eocd: { commentLen: 5 } }))).toBe(
        SAVE_ZIP_NO_EOCD_ERROR
      );
    });

    it('refuses data in front of the first local header', () => {
      // A complete smuggled local entry before the real one; the directory points past it.
      const hidden = new Uint8Array(buildZip([file('evil.exe', 'MZ')]).slice(0, 30 + 8 + 2));
      expect(refusal(buildZip([file('a.txt')], { prefix: hidden }))).toBe(SAVE_ZIP_LAYOUT_ERROR);
    });

    it('refuses a corrupted central-directory signature', () => {
      const zip = buildZip([file('a.txt')]);
      const v = new DataView(zip);
      const cd = v.getUint32(zip.byteLength - 22 + 16, true);
      v.setUint32(cd, 0x02014b51, true);
      expect(refusal(zip)).toBe(SAVE_ZIP_CENTRAL_DIRECTORY_ERROR);
    });

    it('refuses a central record whose name runs past the directory', () => {
      const zip = buildZip([file('a.txt')]);
      const v = new DataView(zip);
      const cd = v.getUint32(zip.byteLength - 22 + 16, true);
      v.setUint16(cd + 28, 2_000, true);
      expect(refusal(zip)).toBe(SAVE_ZIP_CENTRAL_DIRECTORY_ERROR);
    });

    it('refuses bytes between the central directory and the EOCD', () => {
      expect(refusal(buildZip([file('a.txt')], { beforeEocd: new Uint8Array(3) }))).toBe(
        SAVE_ZIP_LAYOUT_ERROR
      );
    });

    it('refuses an EOCD count that does not match the directory', () => {
      const two = buildZip([file('a.txt'), file('b.txt')], {
        eocd: { totalEntries: 1, entriesOnDisk: 1 },
      });
      expect(refusal(two)).toBe(SAVE_ZIP_CENTRAL_DIRECTORY_ERROR);
      const one = buildZip([file('a.txt')], { eocd: { totalEntries: 2, entriesOnDisk: 2 } });
      expect(refusal(one)).toBe(SAVE_ZIP_CENTRAL_DIRECTORY_ERROR);
    });

    it('refuses an entry that starts on another disk', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), diskStart: 1 }]))).toBe(
        SAVE_ZIP_MULTIDISK_ERROR
      );
    });

    it('refuses multi-disk archives', () => {
      expect(refusal(buildZip([file('a.txt')], { eocd: { disk: 1 } }))).toBe(
        SAVE_ZIP_MULTIDISK_ERROR
      );
      expect(refusal(buildZip([file('a.txt')], { eocd: { entriesOnDisk: 0 } }))).toBe(
        SAVE_ZIP_MULTIDISK_ERROR
      );
    });

    it('refuses every zip64 marker rather than parsing it', () => {
      expect(
        refusal(
          buildZip([{ ...file('a.txt'), extra: extraField(0x0001, [0, 0, 0, 0, 0, 0, 0, 0]) }])
        )
      ).toBe(SAVE_ZIP64_ERROR);
      expect(
        refusal(
          buildZip([{ ...file('a.txt'), localExtra: extraField(0x0001, [0, 0, 0, 0, 0, 0, 0, 0]) }])
        )
      ).toBe(SAVE_ZIP64_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), size: 0xffffffff, method: 8 }]))).toBe(
        SAVE_ZIP64_ERROR
      );
      expect(refusal(buildZip([{ ...file('a.txt'), compressedSize: 0xffffffff, method: 8 }]))).toBe(
        SAVE_ZIP64_ERROR
      );
      expect(
        refusal(
          buildZip([file('a.txt')], { eocd: { totalEntries: 0xffff, entriesOnDisk: 0xffff } })
        )
      ).toBe(SAVE_ZIP64_ERROR);
      expect(refusal(buildZip([file('a.txt')], { eocd: { cdOffset: 0xffffffff } }))).toBe(
        SAVE_ZIP64_ERROR
      );
      // A zip64 EOCD locator right before the EOCD.
      const locator = new Uint8Array(20);
      new DataView(locator.buffer).setUint32(0, 0x07064b50, true);
      expect(refusal(buildZip([file('a.txt')], { beforeEocd: locator }))).toBe(SAVE_ZIP64_ERROR);
    });

    it('refuses a malformed extra field block', () => {
      expect(
        refusal(buildZip([{ ...file('a.txt'), extra: new Uint8Array([0x99, 0x99, 9, 0, 1]) }]))
      ).toBe(SAVE_ZIP_EXTRA_FIELD_ERROR);
      expect(refusal(buildZip([{ ...file('a.txt'), extra: new Uint8Array([1, 2, 3]) }]))).toBe(
        SAVE_ZIP_EXTRA_FIELD_ERROR
      );
    });

    it('refuses a compressed size that runs past the central directory', () => {
      expect(refusal(buildZip([{ ...file('a.txt'), method: 8, compressedSize: 5000 }]))).toBe(
        SAVE_ZIP_TRUNCATED_ERROR
      );
    });
  });

  describe('bounds (declared sizes)', () => {
    const { maxEntries, maxTotalUncompressedBytes, maxEntryRatio, ratioFloorBytes } =
      SAVE_ZIP_LIMITS;

    it('pins the chosen bounds', () => {
      expect(SAVE_ZIP_MAX_BYTES).toBe(256 * MB);
      expect(SAVE_ZIP_LIMITS).toEqual({
        maxEntries: 10_000,
        maxTotalUncompressedBytes: 1024 * MB,
        maxEntryRatio: 100,
        ratioFloorBytes: MB,
      });
    });

    it(`accepts ${maxEntries} entries and refuses ${maxEntries + 1}`, () => {
      const many = (n: number) =>
        Array.from({ length: n }, (_, i) => ({ name: `d/${String(i).padStart(5, '0')}.txt` }));
      expect(refusal(buildZip(many(maxEntries)))).toBe('ok');
      expect(refusal(buildZip(many(maxEntries + 1)))).toBe(SAVE_ZIP_TOO_MANY_ENTRIES_ERROR);
    });

    it('per-entry ratio: exactly 100× is accepted, one byte more is refused; small entries are exempt', () => {
      // 20,000 bytes of (fake) deflate data, not a power of two; 100× of it is over the 1 MiB floor.
      const csize = 20_000;
      expect(maxEntryRatio * csize).toBeGreaterThan(ratioFloorBytes);
      const data = new Uint8Array(csize).fill(7);
      const entry = (size: number) => ({ name: 'r.txt', method: 8, data, size });
      expect(refusal(buildZip([entry(maxEntryRatio * csize)]))).toBe('ok');
      expect(refusal(buildZip([entry(maxEntryRatio * csize + 1)]))).toBe(SAVE_ZIP_RATIO_ERROR);
      // 10 compressed bytes declaring 1,000,000 (100,000×) — under the 1 MiB floor, so allowed here
      // (the total cap and the inflate check still bound it).
      expect(
        refusal(buildZip([{ name: 's.txt', method: 8, data: new Uint8Array(10), size: 1_000_000 }]))
      ).toBe('ok');
      expect(
        refusal(
          buildZip([
            { name: 's.txt', method: 8, data: new Uint8Array(10), size: ratioFloorBytes + 1 },
          ])
        )
      ).toBe(SAVE_ZIP_RATIO_ERROR);
    });

    it('total declared size: exactly 1 GiB is accepted, one byte more is refused', () => {
      // Six deflated entries of 3,000,001 compressed bytes each, each declaring < 100× that, summing
      // to exactly the cap — so neither the ratio nor the entry count is the reason.
      const csize = 3_000_001;
      const data = new Uint8Array(csize).fill(3);
      const each = Math.floor(maxTotalUncompressedBytes / 6);
      const last = maxTotalUncompressedBytes - each * 5;
      expect(last).toBeLessThan(maxEntryRatio * csize);
      const entries = (extra: number) =>
        [each, each, each, each, each, last + extra].map((size, i) => ({
          name: `p${i}.txt`,
          method: 8,
          data,
          size,
        }));
      expect(refusal(buildZip(entries(0)))).toBe('ok');
      expect(refusal(buildZip(entries(1)))).toBe(SAVE_ZIP_TOTAL_SIZE_ERROR);
    });
  });
});

// ── Inflate check: declared sizes cannot be walked by lying ─────────────────────────────────────

describe('verifySaveZipInflate — the inflate check', () => {
  it('refuses a deflated entry that inflates to MORE than it declares (a lying bomb)', async () => {
    const real = await jszip(
      { 'zeros.txt': new Uint8Array(5 * MB + 3) },
      { compression: 'DEFLATE' }
    );
    // Declare a size that keeps the ratio under 100× so only the inflate check can catch it.
    const lie = lieAboutSize(real, 9_999);
    const v = validateSaveZip(lie);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(await verifySaveZipInflate(lie, v.deflated)).toBe(
      SAVE_ZIP_INFLATE_ERROR
    );
  });

  it('refuses a deflated entry that inflates to LESS than it declares', async () => {
    const real = await jszip({ 'a.txt': 'short caption' }, { compression: 'DEFLATE' });
    const lie = lieAboutSize(real, 'short caption'.length + 1);
    const v = validateSaveZip(lie);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(await verifySaveZipInflate(lie, v.deflated)).toBe(
      SAVE_ZIP_INFLATE_ERROR
    );
  });

  it('refuses data that is not a deflate stream at all', async () => {
    const zip = buildZip([
      { name: 'a.txt', method: 8, data: new Uint8Array([0xff, 0xff, 0xff, 0xff]), size: 4 },
    ]);
    const v = validateSaveZip(zip);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(await verifySaveZipInflate(zip, v.deflated)).toBe(
      SAVE_ZIP_INFLATE_ERROR
    );
  });
});

describe('error strings', () => {
  it('every zip refusal string is distinct (so a reply names exactly one guard)', () => {
    const all = [
      SAVE_ZIP64_ERROR,
      SAVE_ZIP_ABSOLUTE_PATH_ERROR,
      SAVE_ZIP_ALTERNATE_PATH_ERROR,
      SAVE_ZIP_BACKSLASH_ERROR,
      SAVE_ZIP_CENTRAL_DIRECTORY_ERROR,
      SAVE_ZIP_CONTROL_CHAR_ERROR,
      SAVE_ZIP_DATA_DESCRIPTOR_ERROR,
      SAVE_ZIP_DIRECTORY_DATA_ERROR,
      SAVE_ZIP_DRIVE_OR_COLON_ERROR,
      SAVE_ZIP_DUPLICATE_NAME_ERROR,
      SAVE_ZIP_EMPTY_ERROR,
      SAVE_ZIP_EMPTY_SEGMENT_ERROR,
      SAVE_ZIP_ENCRYPTED_ERROR,
      SAVE_ZIP_EXTRA_FIELD_ERROR,
      SAVE_ZIP_FLAGS_ERROR,
      SAVE_ZIP_HEADER_MISMATCH_ERROR,
      SAVE_ZIP_INFLATE_ERROR,
      SAVE_ZIP_LAYOUT_ERROR,
      SAVE_ZIP_LOCAL_HEADER_ERROR,
      SAVE_ZIP_MULTIDISK_ERROR,
      SAVE_ZIP_NAME_ENCODING_ERROR,
      SAVE_ZIP_NO_EOCD_ERROR,
      SAVE_ZIP_PATH_CONFLICT_ERROR,
      SAVE_ZIP_RATIO_ERROR,
      SAVE_ZIP_SPECIAL_FILE_ERROR,
      SAVE_ZIP_STORED_SIZE_ERROR,
      SAVE_ZIP_TOO_MANY_ENTRIES_ERROR,
      SAVE_ZIP_TOTAL_SIZE_ERROR,
      SAVE_ZIP_TRAVERSAL_ERROR,
      SAVE_ZIP_TRUNCATED_ERROR,
      saveZipEntryTypeError('exe'),
      saveZipMethodError(12),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(saveZipEntryTypeError('exe')).toBe('zip entry type is not allowed: exe');
    expect(saveZipEntryTypeError('')).toBe('zip entry type is not allowed: (none)');
    expect(saveZipMethodError(12)).toBe('zip compression method is not allowed: 12');
  });
});
