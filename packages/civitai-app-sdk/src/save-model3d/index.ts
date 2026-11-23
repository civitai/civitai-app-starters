/**
 * `@civitai/app-sdk/save-model3d` — the App Blocks `SAVE_IMAGE { bytes }` 3D model check: binary
 * glTF (`.glb`) and binary FBX (`.fbx`).
 *
 * 🔴 THE ONE COPY, like `./save-zip`. The civitai.com host and `@civitai/blocks-react`'s
 * `createMockHost` both import this module, so the mock accepts and refuses exactly the models
 * production does. Change the rules here, release, and bump the host's `@civitai/app-sdk`.
 *
 * glTF-JSON (`.gltf`), ASCII FBX and OBJ are NOT model types here: they are text, so the host saves
 * them as `.txt` (and a `.gltf` usually references sidecar files a single save could not carry).
 *
 * Two steps, the same split as the zip rules:
 *   1. {@link looksLikeSaveModel3d} — does the buffer START like one of these? Decided on the first
 *      8 (GLB) or 21 (FBX) bytes, so a caller can pick the per-file cap
 *      ({@link SAVE_MODEL3D_MAX_BYTES}) before decoding anything. Both prefixes contain a NUL byte,
 *      so no text payload can ever be a candidate: refusing a candidate that fails step 2 takes
 *      nothing away from a text classifier that refuses every NUL-bearing buffer.
 *   2. {@link isValidSaveModel3d} — the strict structural check. A GLB must account for EVERY byte
 *      of the buffer in its declared chunks (nothing can ride along after it); an FBX must have a
 *      well-formed run of top-level node records ending in the null record, with no more than a
 *      footer's worth of bytes after it.
 *
 * Dependency-free, browser and Node.
 */

/** The two 3D model types, each with the one extension (no dot) it saves under. */
export const SAVE_MODEL3D_EXTENSION = {
  // IANA-registered.
  'model/gltf-binary': 'glb',
  // FBX has no registered media type; this names it for the Blob without claiming a registration.
  'model/x-fbx': 'fbx',
} as const;

export type SaveModel3dType = keyof typeof SAVE_MODEL3D_EXTENSION;

/**
 * The per-file cap on a buffer that starts like a model: 100 MiB. Generated meshes with embedded
 * textures outgrow the 50 MiB cap of the other bytes types; the host also checks a model against
 * its 100 MiB window budget, so a model at the cap is the only save that window admits.
 */
export const SAVE_MODEL3D_MAX_BYTES = 100 * 1024 * 1024;

/** `glTF` + container version 2 (little-endian u32). */
const GLB_PREFIX = [0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00] as const;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_CHUNK_JSON = 0x4e4f534a; // "JSON" read as a little-endian u32
const GLB_CHUNK_BIN = 0x004e4942; // "BIN\0" read as a little-endian u32

/** `Kaydara FBX Binary` + two spaces + NUL: the binary FBX magic. ASCII FBX starts with `; FBX`. */
const FBX_MAGIC = [
  0x4b, 0x61, 0x79, 0x64, 0x61, 0x72, 0x61, 0x20, 0x46, 0x42, 0x58, 0x20, 0x42, 0x69, 0x6e, 0x61,
  0x72, 0x79, 0x20, 0x20, 0x00,
] as const;
/** Magic, then `0x1A 0x00`, then the u32 version. */
const FBX_HEADER_BYTES = 27;
/**
 * The version range accepted: from 6100 (FBX 2006, the oldest binary writers emit) to 7999. The
 * newest version in use is 7700 (FBX 2020); the bound admits any later 7.x so a newer writer of the
 * same record format is not refused. An 8.x would be a new format and is refused.
 */
const FBX_MIN_VERSION = 6100;
const FBX_MAX_VERSION = 7999;
/** From 7500 a node record's three leading fields are u64 instead of u32. */
const FBX_WIDE_RECORD_VERSION = 7500;
/**
 * The most bytes allowed after the top-level null record. The footer writers emit is 160 bytes
 * plus up to 15 of alignment padding; 256 leaves room for a writer that differs, and still means
 * no second file of any size can follow the node data.
 */
const FBX_MAX_TAIL_BYTES = 256;

function startsWith(u8: Uint8Array, sig: readonly number[]): boolean {
  if (u8.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (u8[i] !== sig[i]) return false;
  return true;
}

/**
 * Which model type the buffer STARTS like (`glTF` + version 2, or the binary FBX magic), or `null`.
 * Reads at most the first 21 bytes. Not a validation: see {@link isValidSaveModel3d}.
 */
export function looksLikeSaveModel3d(view: Uint8Array): SaveModel3dType | null {
  if (startsWith(view, GLB_PREFIX)) return 'model/gltf-binary';
  if (startsWith(view, FBX_MAGIC)) return 'model/x-fbx';
  return null;
}

/** Strict structural check of a buffer that {@link looksLikeSaveModel3d} called `type`. */
export function isValidSaveModel3d(view: Uint8Array, type: SaveModel3dType): boolean {
  return type === 'model/gltf-binary' ? isValidGlb(view) : isValidFbx(view);
}

/**
 * glTF 2.0 binary container (spec §4.4): a 12-byte header whose declared length equals the
 * buffer's, then chunks. The JSON chunk comes first and only first; a BIN chunk, if any, only
 * second; chunks of any other type are allowed after the JSON chunk, because the spec says
 * "Client implementations MUST ignore chunks with unknown types to enable glTF extensions to
 * reference additional chunks with new types following the first two chunks." Every chunk length
 * is a multiple of 4 (the spec's alignment rule), every chunk lies inside the declared length, and
 * the chunks end exactly at it. The JSON chunk must be UTF-8 that parses to an object carrying
 * `asset.version`, the one property glTF requires.
 */
function isValidGlb(u8: Uint8Array): boolean {
  if (u8.length < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) return false;
  if (!startsWith(u8, GLB_PREFIX)) return false;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const length = view.getUint32(8, true);
  if (length !== u8.length || length % 4 !== 0) return false;

  let offset = GLB_HEADER_BYTES;
  let index = 0;
  while (offset < length) {
    if (length - offset < GLB_CHUNK_HEADER_BYTES) return false;
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + GLB_CHUNK_HEADER_BYTES;
    if (chunkLength % 4 !== 0 || chunkLength > length - dataStart) return false;
    if (index === 0) {
      if (chunkType !== GLB_CHUNK_JSON || chunkLength === 0) return false;
      if (!isGltfJson(u8.subarray(dataStart, dataStart + chunkLength))) return false;
    } else if (chunkType === GLB_CHUNK_JSON || (chunkType === GLB_CHUNK_BIN && index !== 1)) {
      // A second JSON chunk, or a BIN chunk anywhere but second: out of the spec's order.
      return false;
    }
    // Every chunk header is 8 bytes, so each pass moves forward and the walk terminates.
    offset = dataStart + chunkLength;
    index += 1;
  }
  return index >= 1 && offset === length;
}

function isGltfJson(bytes: Uint8Array): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return false;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const asset = (doc as { asset?: unknown }).asset;
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return false;
  return typeof (asset as { version?: unknown }).version === 'string';
}

/**
 * Binary FBX: the magic, `0x1A 0x00`, a version from 6100 to 7999, then a walk of the TOP-LEVEL
 * node records. Each record's end offset must lie at or past the end of its own header and name
 * (so the walk moves strictly forward) and stay inside the buffer, its name must be printable
 * ASCII, and the walk must reach the all-zero null record with at least one node before it. At most
 * {@link FBX_MAX_TAIL_BYTES} may follow the null record (the footer). Nested records are not
 * walked: they lie inside a top-level record's span, which the walk has already bounded.
 */
function isValidFbx(u8: Uint8Array): boolean {
  if (u8.length < FBX_HEADER_BYTES) return false;
  if (!startsWith(u8, FBX_MAGIC) || u8[21] !== 0x1a || u8[22] !== 0x00) return false;
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = view.getUint32(23, true);
  if (version < FBX_MIN_VERSION || version > FBX_MAX_VERSION) return false;
  const wide = version >= FBX_WIDE_RECORD_VERSION;
  const fieldBytes = wide ? 8 : 4;
  const recordHeaderBytes = fieldBytes * 3 + 1;
  const readField = (at: number): number =>
    wide ? Number(view.getBigUint64(at, true)) : view.getUint32(at, true);

  let offset = FBX_HEADER_BYTES;
  let nodes = 0;
  for (;;) {
    if (u8.length - offset < recordHeaderBytes) return false;
    const endOffset = readField(offset);
    const numProperties = readField(offset + fieldBytes);
    const propertyListLength = readField(offset + fieldBytes * 2);
    const nameLength = u8[offset + fieldBytes * 3]!;
    if (endOffset === 0) {
      // The null record: every field zero. Ends the top-level list.
      if (numProperties !== 0 || propertyListLength !== 0 || nameLength !== 0) return false;
      const tail = u8.length - (offset + recordHeaderBytes);
      return nodes > 0 && tail <= FBX_MAX_TAIL_BYTES;
    }
    const nameStart = offset + recordHeaderBytes;
    const bodyStart = nameStart + nameLength;
    // A node with no properties and no children ends right after its name; nameLength >= 1 keeps
    // every step strictly forward, so the walk terminates.
    if (nameLength === 0 || endOffset < bodyStart || endOffset > u8.length) return false;
    if (propertyListLength > endOffset - bodyStart) return false;
    for (let i = nameStart; i < bodyStart; i++) {
      const c = u8[i]!;
      if (c < 0x20 || c > 0x7e) return false;
    }
    offset = endOffset;
    nodes += 1;
  }
}
