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

/**
 * The cap on a `bytes` payload: 50 MiB of raw bytes (`ArrayBuffer.byteLength`,
 * so a text or JSON payload is counted after UTF-8 encoding).
 *
 * 🔴 The host spells its OWN copy of this number (civitai/civitai,
 * `saveImageDownload.ts`), and the two MUST match. Nothing in this repository
 * can read the host's value, so a drift is invisible here until a block hits
 * the host's refusal on a buffer this hook let through, or the hook refuses one
 * the host would have saved. Kept local to this package (not exported from
 * `@civitai/app-sdk`) so the hook needs no newer app-sdk peer.
 */
export const SAVE_BYTES_MAX_BYTES = 50 * 1024 * 1024;

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

/** The five types the host can classify a `bytes` payload as. */
export type SaveBytesType = 'image/png' | 'image/webp' | 'image/jpeg' | 'application/json' | 'text/plain';

/** The extension the host forces for each classified type. */
export const SAVE_BYTES_EXTENSION: Record<SaveBytesType, string> = {
  'image/png': '.png',
  'image/webp': '.webp',
  'image/jpeg': '.jpg',
  'application/json': '.json',
  'text/plain': '.txt',
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

/**
 * Classify a `bytes` payload by CONTENT — the host's `classifySaveBytes`.
 * `filename` is the only hint and must already be CLEANED
 * ({@link sanitizeSaveBytesFilename}): a name ending `.json` (case-insensitive)
 * chooses JSON over text/plain for bytes that already parse as JSON, and it can
 * never make a binary payload acceptable. Returns `null` for anything the host
 * refuses (`file type is not allowed`).
 */
export function classifySaveBytes(bytes: ArrayBuffer, filename = ''): SaveBytesType | null {
  const view = new Uint8Array(bytes);
  const image = sniffImageBytes(view);
  if (image) return image;

  if (view.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return null; // not valid UTF-8 — random binary, a GIF, a zip, …
  }
  if (filename.toLowerCase().endsWith('.json')) {
    try {
      JSON.parse(text);
      return 'application/json';
    } catch {
      // A `.json` name on text that does not parse saves as text, not a refusal.
    }
  }
  return 'text/plain';
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

/**
 * Size-cap, clean the name, classify on the CLEANED name, and force the
 * extension — the host's `prepareSaveBytes`, in its order. Every refusal is the
 * reply's error string.
 */
export function prepareSaveBytes(req: {
  bytes: ArrayBuffer;
  filename?: string;
}): { ok: true; type: SaveBytesType; filename: string } | { ok: false; error: string } {
  if (req.bytes.byteLength > SAVE_BYTES_MAX_BYTES) {
    return { ok: false, error: SAVE_BYTES_TOO_LARGE_ERROR };
  }
  const filename = sanitizeSaveBytesFilename(req.filename);
  const type = classifySaveBytes(req.bytes, filename);
  if (!type) return { ok: false, error: SAVE_BYTES_TYPE_NOT_ALLOWED_ERROR };
  return { ok: true, type, filename: forceSaveBytesExtension(filename, type) };
}
