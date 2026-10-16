/**
 * `OPEN_MEDIA_UPLOAD`: the strings and limits both sides of the bridge agree
 * on, the content sniffers, and the mock host's copy of the host's admission
 * rules for BYTES mode.
 *
 * The host owns the real rules. This copy exists so `createMockHost` (and so
 * `dev:harness` and every block test) accepts and refuses the same buffers
 * production does, and so `useMediaUpload` can refuse locally what the host
 * would refuse anyway. Keep it exactly as narrow as the contract: a mock that
 * accepts a GIF as an image teaches a block that GIFs upload.
 *
 * 🔴 The host spells its OWN copy of every constant and string here, and the
 * two MUST match. Nothing in this repository can read the host's values, so a
 * drift is invisible here until a block hits a refusal the SDK did not
 * predict. Kept local to this package (not exported from `@civitai/app-sdk`).
 *
 * WHAT THIS CANNOT MODEL: the host decodes the media before it uploads.
 * Its decode-time refusals (`could not read this video file`,
 * `could not read this audio file`, `this file has no video track`, an image
 * too small to resize to at least 64 px, and upload failures) need a real
 * decoder and network, so the mock never produces them.
 */

import type { BlockMediaKind, BlockMediaUploadInfo } from '@civitai/app-sdk/blocks';

import { sniffImageBytes } from './saveBytes.js';

/** The cap on one upload: 64 MiB of raw bytes (the consumer-blob upload cap). */
export const MEDIA_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
/** The bytes-mode rolling window: per this many milliseconds, per mounted page host… */
export const MEDIA_UPLOAD_WINDOW_MS = 60_000;
/** …at most this many admitted bytes uploads… */
export const MEDIA_UPLOAD_MAX_PER_WINDOW = 8;
/** …and this many admitted bytes. */
export const MEDIA_UPLOAD_MAX_BYTES_PER_WINDOW = 2 * MEDIA_UPLOAD_MAX_BYTES;

/** `bytes` is not a non-empty `ArrayBuffer`, or `mimeType` is present but not a string. */
export const MEDIA_UPLOAD_INVALID_ERROR = 'invalid media-upload request';
export const MEDIA_UPLOAD_KIND_ERROR = "kind must be 'image', 'video' or 'audio'";
export const MEDIA_UPLOAD_PURPOSE_ERROR = "purpose must be 'generationSource'";
export const MEDIA_UPLOAD_TOO_LARGE_ERROR = 'file exceeds the 64 MB upload limit';
/** The sniffed content is not one of the requested kind's types. */
export const MEDIA_UPLOAD_TYPE_ERROR: Readonly<Record<BlockMediaKind, string>> = {
  image: 'images must be PNG, JPEG or WebP',
  video: 'videos must be MP4 or WebM',
  audio: 'audio must be MP3, WAV or WebM',
};
export const MEDIA_UPLOAD_MIME_MISMATCH_ERROR = "mimeType does not match the file's content";
/** The bytes-mode window is full. Retryable. */
export const MEDIA_UPLOAD_BUSY_ERROR = 'busy';

/** The kinds the bridge knows. */
export const MEDIA_UPLOAD_KINDS: readonly BlockMediaKind[] = ['image', 'video', 'audio'];

export function isMediaKind(v: unknown): v is BlockMediaKind {
  return typeof v === 'string' && (MEDIA_UPLOAD_KINDS as readonly string[]).includes(v);
}

/** One admitted bytes upload in the window: when, and how many bytes. */
export type MediaUploadWindowEntry = { at: number; size: number };

function asciiAt(u8: Uint8Array, text: string, offset = 0): boolean {
  if (u8.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (u8[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** WebM: the EBML magic, and the DocType `webm` within the first 64 bytes (generic Matroska is refused). */
function isWebm(u8: Uint8Array): boolean {
  if (!(u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3)) return false;
  const head = u8.subarray(0, 64);
  for (let i = 0; i + 4 <= head.length; i++) {
    if (asciiAt(head, 'webm', i)) return true;
  }
  return false;
}

/** MP4: `ftyp` at offset 4 of a buffer at least 12 bytes long. */
function isMp4(u8: Uint8Array): boolean {
  return u8.length >= 12 && asciiAt(u8, 'ftyp', 4);
}

/** MP3: an ID3 tag, or an MPEG audio frame sync with a valid version and layer. */
function isMp3(u8: Uint8Array): boolean {
  if (asciiAt(u8, 'ID3')) return true;
  if (u8.length < 2) return false;
  const b0 = u8[0]!;
  const b1 = u8[1]!;
  return b0 === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 0x03) !== 0 && ((b1 >> 3) & 0x03) !== 1;
}

/** WAV: `RIFF` at 0 and `WAVE` at 8. */
function isWav(u8: Uint8Array): boolean {
  return asciiAt(u8, 'RIFF') && asciiAt(u8, 'WAVE', 8);
}

/**
 * The content type of `bytes` WITHIN the requested kind, by magic bytes, or
 * `null` when the content is none of that kind's types (a PNG sent as `audio`
 * is `null`: a type refusal). WebM is `video/webm` under `video` and
 * `audio/webm` under `audio`.
 */
export function sniffMediaBytes(kind: BlockMediaKind, u8: Uint8Array): string | null {
  switch (kind) {
    case 'image':
      return sniffImageBytes(u8);
    case 'video':
      if (isMp4(u8)) return 'video/mp4';
      if (isWebm(u8)) return 'video/webm';
      return null;
    case 'audio':
      if (isMp3(u8)) return 'audio/mpeg';
      if (isWav(u8)) return 'audio/wav';
      if (isWebm(u8)) return 'audio/webm';
      return null;
  }
}

/** A declared MIME type as the host compares it: lowercased, `;params` cut, `audio/x-wav` read as `audio/wav`. */
export function normaliseMediaMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  return base === 'audio/x-wav' ? 'audio/wav' : base;
}

function windowHasRoom(live: readonly MediaUploadWindowEntry[], size: number): boolean {
  const total = live.reduce((sum, e) => sum + e.size, 0);
  return live.length < MEDIA_UPLOAD_MAX_PER_WINDOW && total + size <= MEDIA_UPLOAD_MAX_BYTES_PER_WINDOW;
}

/**
 * The host's decision for one `OPEN_MEDIA_UPLOAD`, in the host's order, from
 * step 4 of the contract on (the caller has already dropped an unroutable
 * `requestId`; review mode and readiness do not exist in the mock):
 *   1. `kind` not known → kind error; `purpose` not `'generationSource'` →
 *      purpose error;
 *   2. no `bytes` (absent or `null`) → PICKER mode (not windowed: a human
 *      picks);
 *   3. `bytes` not a non-empty `ArrayBuffer`, or a non-string `mimeType` →
 *      invalid;
 *   4. over the cap → too large, FIRST, so an over-cap file is never `busy`
 *      (a retry could never succeed);
 *   5. the window, NOT recording, so a full window refuses `busy` before any
 *      sniffing;
 *   6. the sniffed content in the kind's set → else the kind's type error;
 *   7. a present `mimeType` (normalised) equal to the sniffed type → else
 *      mismatch;
 *   8. record the upload in the window. Only an upload that will run counts.
 * Returns the pruned window to store back.
 */
export function admitMediaUpload(
  raw: { kind?: unknown; purpose?: unknown; bytes?: unknown; mimeType?: unknown },
  recent: readonly MediaUploadWindowEntry[],
  now: number,
): {
  result:
    | { ok: true; mode: 'picker'; kind: BlockMediaKind }
    | { ok: true; mode: 'bytes'; kind: BlockMediaKind; bytes: ArrayBuffer; mimeType: string }
    | { ok: false; error: string };
  recent: MediaUploadWindowEntry[];
} {
  const live = recent.filter((e) => now - e.at < MEDIA_UPLOAD_WINDOW_MS);
  const refuse = (error: string) => ({ result: { ok: false as const, error }, recent: live });
  if (!isMediaKind(raw.kind)) return refuse(MEDIA_UPLOAD_KIND_ERROR);
  const kind = raw.kind;
  if (raw.purpose !== 'generationSource') return refuse(MEDIA_UPLOAD_PURPOSE_ERROR);
  // `null` reads as absent, as `OPEN_IMAGE_UPLOAD`'s `bytes` does.
  if (raw.bytes == null) return { result: { ok: true, mode: 'picker', kind }, recent: live };

  const bytes = raw.bytes;
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return refuse(MEDIA_UPLOAD_INVALID_ERROR);
  if (raw.mimeType !== undefined && typeof raw.mimeType !== 'string') {
    return refuse(MEDIA_UPLOAD_INVALID_ERROR);
  }
  const size = bytes.byteLength;
  if (size > MEDIA_UPLOAD_MAX_BYTES) return refuse(MEDIA_UPLOAD_TOO_LARGE_ERROR);
  if (!windowHasRoom(live, size)) return refuse(MEDIA_UPLOAD_BUSY_ERROR);
  const sniffed = sniffMediaBytes(kind, new Uint8Array(bytes));
  if (!sniffed) return refuse(MEDIA_UPLOAD_TYPE_ERROR[kind]);
  if (typeof raw.mimeType === 'string' && normaliseMediaMimeType(raw.mimeType) !== sniffed) {
    return refuse(MEDIA_UPLOAD_MIME_MISMATCH_ERROR);
  }
  return {
    result: { ok: true, mode: 'bytes', kind, bytes, mimeType: sniffed },
    recent: [...live, { at: now, size }],
  };
}

/**
 * The mock host's canned uploads, one per kind. A kind left out answers
 * {@link DEFAULT_MOCK_MEDIA_UPLOADS}; `null` for a kind = the viewer closes that
 * picker (bytes mode, which has no picker, then answers the default).
 */
export type MockMediaUploads = Partial<Record<BlockMediaKind, BlockMediaUploadInfo | null>>;

/**
 * What the mock host answers when no canned upload is configured for a kind.
 * Every field differs between kinds, so a block that mixes two up shows it.
 * The URLs are deliberately unresolvable: the mock uploads nothing.
 */
export const DEFAULT_MOCK_MEDIA_UPLOADS: Readonly<Record<BlockMediaKind, BlockMediaUploadInfo>> = {
  image: {
    url: 'https://media.mock.invalid/generation-input/dev-image.jpeg',
    kind: 'image',
    mimeType: 'image/jpeg',
    sizeBytes: 182_311,
    width: 1024,
    height: 768,
  },
  video: {
    url: 'https://media.mock.invalid/generation-input/dev-video.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 4_812_330,
    width: 1280,
    height: 720,
    durationMs: 5_000,
  },
  audio: {
    url: 'https://media.mock.invalid/generation-input/dev-audio.mp3',
    kind: 'audio',
    mimeType: 'audio/mpeg',
    sizeBytes: 961_204,
    durationMs: 30_000,
  },
};

/**
 * The mock host's whole answer to one routable `OPEN_MEDIA_UPLOAD`, on a page
 * surface: {@link admitMediaUpload}, then
 *  - picker mode: the canned upload for the kind, or a bare reply (dismissed)
 *    when that kind is canned `null`;
 *  - bytes mode: the canned upload for the kind (the default when it is
 *    `null`: there is no viewer to dismiss), carrying what the host would
 *    report for THESE bytes: the sniffed `mimeType` and the buffer's size for
 *    video and audio; `image/jpeg` and the canned size for an image, which the
 *    host re-encodes;
 *  - `forcedError`, when set, replaces a success: the stand-in for the
 *    decode and upload failures the mock cannot produce. A bytes upload it
 *    fails has still been admitted, so it still counts against the window, as
 *    on the host.
 */
export function mockMediaUploadReply(args: {
  payload: { kind?: unknown; purpose?: unknown; bytes?: unknown; mimeType?: unknown };
  canned: MockMediaUploads;
  forcedError: string | undefined;
  recent: readonly MediaUploadWindowEntry[];
  now: number;
}): {
  reply: { selected: BlockMediaUploadInfo } | { error: string } | Record<string, never>;
  recent: MediaUploadWindowEntry[];
} {
  const admitted = admitMediaUpload(args.payload, args.recent, args.now);
  const { result, recent } = admitted;
  if (!result.ok) return { reply: { error: result.error }, recent };
  if (args.forcedError !== undefined) return { reply: { error: args.forcedError }, recent };
  // A kind left out of `canned` answers the default; one set to `null` dismisses.
  const configured = args.canned[result.kind];
  const canned = configured === undefined ? DEFAULT_MOCK_MEDIA_UPLOADS[result.kind] : configured;
  if (result.mode === 'picker') {
    return { reply: canned ? { selected: { ...canned, kind: result.kind } } : {}, recent };
  }
  const base = canned ?? DEFAULT_MOCK_MEDIA_UPLOADS[result.kind];
  const selected: BlockMediaUploadInfo =
    result.kind === 'image'
      ? { ...base, kind: 'image', mimeType: 'image/jpeg' }
      : { ...base, kind: result.kind, mimeType: result.mimeType, sizeBytes: result.bytes.byteLength };
  return { reply: { selected }, recent };
}
