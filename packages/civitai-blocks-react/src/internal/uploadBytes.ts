/**
 * The `bytes` variant of `OPEN_IMAGE_UPLOAD`: the strings both sides of the
 * bridge agree on, and the mock host's copy of the host's admission rules.
 *
 * The contract is civitai/civitai#5639 (`imageUploadBytes.ts` in the host). The
 * host owns the real rules. This copy exists so `createMockHost` (and so
 * `dev:harness` and every block test) accepts and refuses the same buffers
 * production does. Keep it exactly as narrow as the contract: a mock that
 * accepts a GIF teaches a block that GIFs upload.
 */

import {
  forceSaveBytesExtension,
  sanitizeSaveBytesFilename,
  sniffImageBytes,
  type SniffedImageType,
} from './saveBytes.js';

/**
 * The cap on one `bytes` upload: 40 MiB of raw bytes (`ArrayBuffer.byteLength`).
 *
 * 🔴 The host spells its OWN copy of this number (civitai/civitai
 * `BLOCK_IMAGE_MAX_BYTES`, the image pipeline's server cap), and the two MUST
 * match. Nothing in this repository can read the host's value, so a drift is
 * invisible here until a block hits the host's refusal on a buffer this hook let
 * through, or the hook refuses one the host would have accepted. Kept local to
 * this package (not exported from `@civitai/app-sdk`) so the hook needs no newer
 * app-sdk peer.
 */
export const UPLOAD_BYTES_MAX_BYTES = 40 * 1024 * 1024;

/** The host's rolling window: at most this many admitted uploads… */
export const UPLOAD_BYTES_MAX_PER_WINDOW = 3;
/** …and this many admitted bytes… */
export const UPLOAD_BYTES_MAX_BYTES_PER_WINDOW = 2 * UPLOAD_BYTES_MAX_BYTES;
/** …per this many milliseconds, per mounted page host. */
export const UPLOAD_BYTES_WINDOW_MS = 60_000;

/** Not a non-empty `ArrayBuffer`, or `purpose: 'generationSource'` with `bytes`. */
export const UPLOAD_BYTES_INVALID_ERROR = 'invalid image-upload request';
/** Over {@link UPLOAD_BYTES_MAX_BYTES}. Also the hook's own pre-send refusal. */
export const UPLOAD_BYTES_TOO_LARGE_ERROR = 'file exceeds the maximum upload size';
/** Not PNG / WebP / JPEG by magic bytes. */
export const UPLOAD_BYTES_TYPE_NOT_ALLOWED_ERROR = 'file type is not allowed';
/** The host's rolling window is full. Retryable. */
export const UPLOAD_BYTES_BUSY_ERROR = 'busy';
/** The host holds no block token. */
export const UPLOAD_BYTES_NO_TOKEN_ERROR = 'no block token';

/** `Image.name`'s bound in the host's persist input. */
const UPLOAD_BYTES_MAX_FILENAME_LENGTH = 255;

/** One admitted upload in the window: when, and how many bytes. */
export type UploadBytesWindowEntry = { at: number; size: number };

/**
 * Which `OPEN_IMAGE_UPLOAD` variant a raw payload is, by the host's predicate
 * (`resolveImageUploadBytes`). `none`: no `bytes` (null or absent), so the
 * picker paths run unchanged. `invalid`: `bytes` is not an `ArrayBuffer` (a
 * typed-array view is refused, not unwrapped), is empty, or comes with
 * `purpose: 'generationSource'`.
 */
export function resolveUploadBytesRequest(raw: {
  bytes?: unknown;
  purpose?: unknown;
  filename?: unknown;
}):
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'bytes'; bytes: ArrayBuffer; filename?: string } {
  if (raw.bytes == null) return { kind: 'none' };
  if (!(raw.bytes instanceof ArrayBuffer) || raw.bytes.byteLength === 0) return { kind: 'invalid' };
  if (raw.purpose === 'generationSource') return { kind: 'invalid' };
  return {
    kind: 'bytes',
    bytes: raw.bytes,
    filename: typeof raw.filename === 'string' ? raw.filename : undefined,
  };
}

function windowHasRoom(
  live: readonly UploadBytesWindowEntry[],
  size: number,
): boolean {
  const total = live.reduce((sum, e) => sum + e.size, 0);
  return live.length < UPLOAD_BYTES_MAX_PER_WINDOW && total + size <= UPLOAD_BYTES_MAX_BYTES_PER_WINDOW;
}

/** The host's stored name: the save-bytes cleaning, the sniffed extension, then 255 characters. */
function uploadBytesFilename(raw: string | undefined, type: SniffedImageType): string {
  const name = forceSaveBytesExtension(sanitizeSaveBytesFilename(raw), type);
  if (name.length <= UPLOAD_BYTES_MAX_FILENAME_LENGTH) return name;
  const ext = name.slice(name.lastIndexOf('.'));
  return name.slice(0, UPLOAD_BYTES_MAX_FILENAME_LENGTH - ext.length) + ext;
}

/**
 * The host's admission decision (`processUploadBytes`), in its order:
 *   1. the per-file cap, FIRST, so an over-cap file is always too large and
 *      never `busy` (a retry could never succeed);
 *   2. the window, NOT recording, so a full window refuses `busy` before any
 *      sniffing;
 *   3. PNG / WebP / JPEG by magic bytes;
 *   4. record the upload in the window. Only an upload that will run counts.
 * Returns the pruned window to store back.
 */
export function admitUploadBytes(
  req: { bytes: ArrayBuffer; filename?: string },
  recent: readonly UploadBytesWindowEntry[],
  now: number,
): {
  result: { ok: true; type: SniffedImageType; filename: string } | { ok: false; error: string };
  recent: UploadBytesWindowEntry[];
} {
  const size = req.bytes.byteLength;
  const live = recent.filter((e) => now - e.at < UPLOAD_BYTES_WINDOW_MS);
  if (size > UPLOAD_BYTES_MAX_BYTES) {
    return { result: { ok: false, error: UPLOAD_BYTES_TOO_LARGE_ERROR }, recent: live };
  }
  if (!windowHasRoom(live, size)) {
    return { result: { ok: false, error: UPLOAD_BYTES_BUSY_ERROR }, recent: live };
  }
  const type = sniffImageBytes(new Uint8Array(req.bytes));
  if (!type) {
    return { result: { ok: false, error: UPLOAD_BYTES_TYPE_NOT_ALLOWED_ERROR }, recent: live };
  }
  return {
    result: { ok: true, type, filename: uploadBytesFilename(req.filename, type) },
    recent: [...live, { at: now, size }],
  };
}
