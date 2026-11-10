/**
 * The `bytes` variant of `SAVE_IMAGE` — the strings both sides of the bridge
 * agree on, and the mock host's copy of the host's CONTENT classifier.
 *
 * The contract is civitai/civitai-app-starters#583. The host owns the real
 * classifier; this one exists so `createMockHost` (and so `dev:harness` and
 * every block test) accepts and refuses the same buffers production does. Keep
 * it exactly as narrow as the contract — a mock that accepts a GIF teaches a
 * block that GIFs save.
 */

/*
 * 🔴 NO import of `@civitai/app-sdk/save-zip` in this file. It is reached from the MAIN entry
 * (`useSaveImage`), and the main entry must load on every app-sdk the peer floor admits (>=0.57.0),
 * while `./save-zip` first ships in 0.85.0. The two things the hook needs from the zip rules — the
 * zip-candidate test and the 256 MiB cap — are restated below and pinned EQUAL to app-sdk's own
 * (`looksLikeSaveZip`, `SAVE_ZIP_MAX_BYTES`) by test/saveBytesZipParity.test.ts, against the
 * workspace app-sdk, so a drift fails CI. Everything that needs the validator itself lives in
 * ./saveBytesPrepare.ts, which only `createMockHost` (the `./testing` entry) reaches;
 * test/mainEntryNoSaveZip.test.ts checks that on the BUILT entries.
 */

/**
 * The cap on a `bytes` payload: 50 MiB of raw bytes (`ArrayBuffer.byteLength`,
 * so a text or JSON payload is counted after UTF-8 encoding).
 *
 * 🔴 The host spells its OWN copy of this number (civitai/civitai,
 * `saveImageDownload.ts`), and the two MUST match. Nothing in this repository
 * can read the host's value, so a drift is invisible here until a block hits
 * the host's refusal on a buffer this hook let through, or the hook refuses one
 * the host would have saved. (The zip cap below is pinned to app-sdk's own by a test.)
 */
export const SAVE_BYTES_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The cap on a `bytes` payload that STARTS like a zip (a local file header at
 * byte 0, or an empty archive): 256 MiB. A restatement of app-sdk's
 * `SAVE_ZIP_MAX_BYTES` (see the note at the top of this file), pinned equal to it.
 */
export const SAVE_BYTES_ZIP_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Does this buffer START like a zip — a local file header (`PK\x03\x04`) or
 * the 22-byte empty archive's end record (`PK\x05\x06`) at byte 0? The same
 * predicate as app-sdk's `looksLikeSaveZip` (pinned equal to it), restated so
 * the main entry needs no `./save-zip`.
 */
export function startsLikeZip(view: Uint8Array): boolean {
  if (view.length < 4 || view[0] !== 0x50 || view[1] !== 0x4b) return false;
  return (view[2] === 0x03 && view[3] === 0x04) || (view[2] === 0x05 && view[3] === 0x06);
}

/**
 * The cap that applies to this buffer, decided on its first four bytes alone —
 * the host's order, so the hook can refuse an over-cap buffer before copying it.
 */
export function saveBytesMaxBytes(bytes: ArrayBuffer): number {
  return startsLikeZip(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)))
    ? SAVE_BYTES_ZIP_MAX_BYTES
    : SAVE_BYTES_MAX_BYTES;
}

/** Host refusal for a buffer over `SAVE_BYTES_MAX_BYTES`. Also the hook's own pre-send refusal. */
export const SAVE_BYTES_TOO_LARGE_ERROR = 'file exceeds the maximum save size';

/** Host refusal for bytes that classify as none of PNG / WebP / JPEG / UTF-8 text. */
export const SAVE_BYTES_TYPE_NOT_ALLOWED_ERROR = 'file type is not allowed';

/**
 * Host refusal for a request that is not exactly one of `url` / `imageId` /
 * `bytes`, for a `bytes` that is not a non-empty `ArrayBuffer`, and what a host
 * that predates the `bytes` variant replies to one.
 */
export const SAVE_IMAGE_INVALID_REQUEST_ERROR = 'invalid save-image request';

/**
 * Which `SAVE_IMAGE` variant a payload is, by the host's exact predicate
 * (civitai/civitai `saveImageDownload.ts`, `resolveSaveImageRequest`). A
 * non-null `bytes` wins the dispatch: ANY non-null `url` / `imageId` beside it
 * (even `''` or `'5'`) is ambiguous and invalid, and `bytes` must be a
 * non-empty `ArrayBuffer`. Without `bytes` (`null` or absent) exactly one of a
 * non-empty string `url` / a positive-integer `imageId` must be present.
 */
export function saveImageRequestKind(p: {
  url?: unknown;
  imageId?: unknown;
  bytes?: unknown;
}): 'url' | 'id' | 'bytes' | 'invalid' {
  if (p.bytes != null) {
    if (p.url != null || p.imageId != null) return 'invalid';
    if (!(p.bytes instanceof ArrayBuffer) || p.bytes.byteLength === 0) return 'invalid';
    return 'bytes';
  }
  const hasUrl = typeof p.url === 'string' && p.url.length > 0;
  const hasId = typeof p.imageId === 'number' && Number.isInteger(p.imageId) && p.imageId > 0;
  if (hasUrl === hasId) return 'invalid';
  return hasUrl ? 'url' : 'id';
}

/** The six types the host can classify a `bytes` payload as. */
export type SaveBytesType =
  | 'image/png'
  | 'image/webp'
  | 'image/jpeg'
  | 'application/json'
  | 'text/plain'
  | 'application/zip';

/** The extension the host forces for each classified type. */
export const SAVE_BYTES_EXTENSION: Record<SaveBytesType, string> = {
  'image/png': '.png',
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'application/json': '.json',
  'text/plain': '.txt',
  'application/zip': '.zip',
};

function startsWith(view: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (view.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (view[offset + i] !== sig[i]) return false;
  }
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // "WEBP" at offset 8

/** The three image types the host recognises by magic bytes. */
export type SniffedImageType = 'image/png' | 'image/webp' | 'image/jpeg';

/**
 * PNG / WebP / JPEG by magic bytes — the host's shared sniffer
 * (`sniffSaveBytesImage`: the full 8-byte PNG signature, no GIF). Both `bytes`
 * bridges use it: `SAVE_IMAGE` before its text fallback, and
 * `OPEN_IMAGE_UPLOAD`, which accepts images only.
 */
export function sniffImageBytes(view: Uint8Array): SniffedImageType | null {
  if (startsWith(view, PNG)) return 'image/png';
  if (startsWith(view, RIFF) && startsWith(view, WEBP, 8)) return 'image/webp';
  if (startsWith(view, JPEG)) return 'image/jpeg';
  return null;
}

/*
 * 🔴 The three functions below are a LINE-FOR-LINE port of the host's bytes
 * filename rules (civitai/civitai `src/components/AppBlocks/saveImageDownload.ts`:
 * `sanitizeDownloadFilename`, `sanitizeSaveBytesFilename`,
 * `forceSaveBytesExtension`, `prepareSaveBytes`, as of civitai/civitai#5616 head
 * 745624bc). Change them only together with the host, and keep
 * test/saveBytesParity.test.ts — the host's own cases — green.
 */

/** The host's shared url/imageId download-name cleaner, used here only with a string name. */
function sanitizeDownloadFilename(name: string): string {
  // Drop any directory component / traversal.
  let clean = name.split(/[\\/]/).pop() ?? name;
  // The host's query/fragment cut — a no-op for a bytes name, whose `?`/`#` are already replaced.
  clean = clean.split('?')[0]!.split('#')[0]!;
  // Collapse a duplicated trailing extension, preserving base dots.
  const extMatch = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
  if (extMatch) {
    const ext = extMatch[1]!;
    clean = clean.replace(new RegExp(`(\\.${ext})+$`), `.${ext}`);
  }
  clean = clean.trim();
  return clean.length > 0 ? clean : 'download';
}

/**
 * Clean a block-supplied `bytes` filename BEFORE classification reads its
 * `.json` suffix. The name is not a URL, so every `?` and `#` is REPLACED with
 * `_` (not cut at): `issue#42.json` → `issue_42.json` (still JSON),
 * `data.json?v=2` → `data.json_v=2` (no longer `.json`, so text). Then: keep
 * the text after the last `/` or `\`, collapse a repeated trailing extension,
 * trim; absent or empty → `download`.
 */
export function sanitizeSaveBytesFilename(name: string | undefined | null): string {
  return sanitizeDownloadFilename((name ?? 'download').replace(/[?#]/g, '_'));
}

/**
 * Replace the extension of a cleaned name with the classified type's own. First
 * deletes every control and format character (`\p{Cc}` / `\p{Cf}`: bidi
 * overrides, zero-width marks), trims, empty → `download`; then replaces a
 * trailing `.<1–5 ASCII letters/digits>` that follows a non-empty base, or
 * appends the extension when there is none (`.env` → `.env.txt`,
 * `notes.markdown` → `notes.markdown.txt`).
 */
export function forceSaveBytesExtension(filename: string, type: SaveBytesType): string {
  const cleaned = filename.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  const name = cleaned.length > 0 ? cleaned : 'download';
  const m = name.match(/^(.+)\.([a-zA-Z0-9]{1,5})$/);
  return `${m ? m[1] : name}${SAVE_BYTES_EXTENSION[type]}`;
}
