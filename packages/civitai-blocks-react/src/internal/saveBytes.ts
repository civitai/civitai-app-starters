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

/**
 * Classify a `bytes` payload by CONTENT. `filename` is the only hint: a name
 * ending `.json` (case-insensitive) chooses JSON over text/plain for bytes that
 * already parse as JSON, and it can never make a binary payload acceptable.
 * Returns `null` for anything the host refuses (`file type is not allowed`).
 */
export function classifySaveBytes(bytes: ArrayBuffer, filename?: string): SaveBytesType | null {
  const view = new Uint8Array(bytes);
  if (startsWith(view, PNG)) return 'image/png';
  if (startsWith(view, RIFF) && startsWith(view, WEBP, 8)) return 'image/webp';
  if (startsWith(view, JPEG)) return 'image/jpeg';

  if (view.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(view);
  } catch {
    return null; // not valid UTF-8 — random binary, a GIF, a zip, …
  }
  if (typeof filename === 'string' && /\.json$/i.test(filename)) {
    try {
      JSON.parse(text);
      return 'application/json';
    } catch {
      // A `.json` name on text that does not parse saves as text, not a refusal.
    }
  }
  return 'text/plain';
}

/**
 * The download name the mock reports: the caller's basename with any extension
 * replaced by the one the classified type forces. ⚠️ An APPROXIMATION of the
 * host's sanitizer — it agrees on the forced extension, which is the contract;
 * the exact character-level sanitizing is the host's and is not mirrored.
 */
export function forcedSaveBytesFilename(filename: string | undefined, type: SaveBytesType): string {
  const base = (filename ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '_') || 'download';
  return stem + SAVE_BYTES_EXTENSION[type];
}
