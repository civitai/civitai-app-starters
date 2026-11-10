/**
 * Minimal zip writer for the `SAVE_IMAGE { bytes }` zip tests: STORED entries (or raw deflate
 * data you pass in), local headers + central directory + EOCD laid end to end, as any plain zip
 * writer produces them. Deliberately tiny so a test's fixture is readable byte for byte.
 */

export type ZipFixtureEntry = {
  name: string;
  data?: Uint8Array;
  /** 0 = stored (default), 8 = deflate (pass already-deflated `data` and the real `size`). */
  method?: number;
  /** Declared uncompressed size; defaults to data.length. */
  size?: number;
  /** The uncompressed bytes of a DEFLATED entry, so its declared CRC-32 is the real one. */
  plain?: Uint8Array;
};

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

export function zipFixture(entries: ZipFixtureEntry[]): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  let length = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    length += b.length;
  };
  const u16 = (v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    push(b);
  };
  const u32 = (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    push(b);
  };
  const header = (e: ZipFixtureEntry, name: Uint8Array, data: Uint8Array) => {
    u16(20); // version needed
    u16(0); // flags
    u16(e.method ?? 0);
    u16(0); // time
    u16(0x21); // date
    // The REAL CRC-32 (the validator checks it): of the stored data, or of `plain` for deflate.
    u32((e.method ?? 0) === 0 ? crc32(data) : e.plain ? crc32(e.plain) : 0x1234abcd);
    u32(data.length);
    u32(e.size ?? data.length);
    u16(name.length);
    u16(0); // extra length
  };
  const offsets: number[] = [];
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = e.data ?? new Uint8Array(0);
    offsets.push(length);
    u32(0x04034b50);
    header(e, name, data);
    push(name);
    push(data);
  }
  const cdOffset = length;
  entries.forEach((e, i) => {
    const name = enc.encode(e.name);
    const data = e.data ?? new Uint8Array(0);
    u32(0x02014b50);
    u16(20); // version made by
    header(e, name, data);
    u16(0); // comment length
    u16(0); // disk start
    u16(0); // internal attrs
    u32(0); // external attrs
    u32(offsets[i]!);
    push(name);
  });
  const cdSize = length - cdOffset;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(cdSize);
  u32(cdOffset);
  u16(0);
  const out = new Uint8Array(length);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

/** A buffer of `size` bytes that STARTS like a zip (a local-header signature) — for the cap tests. */
export function zipLookingBuffer(size: number): ArrayBuffer {
  const u8 = new Uint8Array(size);
  u8.set([0x50, 0x4b, 0x03, 0x04]);
  return u8.buffer;
}
