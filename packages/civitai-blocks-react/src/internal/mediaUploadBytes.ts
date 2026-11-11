/**
 * `OPEN_MEDIA_UPLOAD` and `OPEN_MEDIA_UPLOAD_BATCH`: the strings and limits
 * both sides of the bridge agree on, the content sniffers, and the mock host's
 * copy of the host's admission rules for BYTES mode and for a batch.
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

import type {
  BlockMediaKind,
  BlockMediaUploadBatchItemResult,
  BlockMediaUploadInfo,
} from '@civitai/app-sdk/blocks';

import { sniffImageBytes } from './saveBytes.js';

/** The cap on one VIDEO or AUDIO upload: 64 MiB of raw bytes (the consumer-blob upload cap). */
export const MEDIA_UPLOAD_MAX_BYTES = 64 * 1024 * 1024;
/**
 * The cap on one IMAGE upload: 24 MiB. Lower than {@link MEDIA_UPLOAD_MAX_BYTES}
 * because the host decodes an image in full before it resizes it.
 */
export const MEDIA_UPLOAD_IMAGE_MAX_BYTES = 24 * 1024 * 1024;
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
/** Over {@link MEDIA_UPLOAD_MAX_BYTES} (video, audio). */
export const MEDIA_UPLOAD_TOO_LARGE_ERROR = 'file exceeds the 64 MB upload limit';
/** Over {@link MEDIA_UPLOAD_IMAGE_MAX_BYTES} (image). */
export const MEDIA_UPLOAD_IMAGE_TOO_LARGE_ERROR = 'file exceeds the 24 MB image upload limit';
/** Bytes mode only: the host holds no block token. Checked before the cap and the window. */
export const MEDIA_UPLOAD_NO_TOKEN_ERROR = 'no block token';
/** The sniffed content is not one of the requested kind's types. */
export const MEDIA_UPLOAD_TYPE_ERROR: Readonly<Record<BlockMediaKind, string>> = {
  image: 'images must be PNG, JPEG or WebP',
  video: 'videos must be MP4 or WebM',
  audio: 'audio must be MP3, WAV or WebM',
};
export const MEDIA_UPLOAD_MIME_MISMATCH_ERROR = "mimeType does not match the file's content";
/** The bytes-mode window is full. Retryable. */
export const MEDIA_UPLOAD_BUSY_ERROR = 'busy';

/** `OPEN_MEDIA_UPLOAD_BATCH`: at most this many items in one batch (and at least 1). */
export const MEDIA_UPLOAD_BATCH_MAX_ITEMS = 1200;
/** `OPEN_MEDIA_UPLOAD_BATCH`: at most this many raw bytes across all of a batch's items (5 GiB). */
export const MEDIA_UPLOAD_BATCH_MAX_BYTES = 5 * 1024 ** 3;
/** How long the host keeps a batch's uploads: 7 days after the batch started (`expiresAt`). */
export const MEDIA_UPLOAD_BATCH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** The batch is not `{ purpose, items: [...objects] }`: `items` is not an array, or an entry is not an object. */
export const MEDIA_UPLOAD_BATCH_INVALID_ERROR = 'invalid media-upload batch request';
/** No items, or more than {@link MEDIA_UPLOAD_BATCH_MAX_ITEMS}. */
export const MEDIA_UPLOAD_BATCH_COUNT_ERROR = 'a batch holds 1 to 1200 files';
/** The items' raw bytes add up to more than {@link MEDIA_UPLOAD_BATCH_MAX_BYTES}. */
export const MEDIA_UPLOAD_BATCH_TOO_LARGE_ERROR = 'the batch exceeds the 5 GB limit';

/** The kinds the bridge knows. */
export const MEDIA_UPLOAD_KINDS: readonly BlockMediaKind[] = ['image', 'video', 'audio'];

export function isMediaKind(v: unknown): v is BlockMediaKind {
  return typeof v === 'string' && (MEDIA_UPLOAD_KINDS as readonly string[]).includes(v);
}

/** The per-file cap for a kind, and the refusal past it. */
export function mediaUploadCap(kind: BlockMediaKind): { maxBytes: number; error: string } {
  return kind === 'image'
    ? { maxBytes: MEDIA_UPLOAD_IMAGE_MAX_BYTES, error: MEDIA_UPLOAD_IMAGE_TOO_LARGE_ERROR }
    : { maxBytes: MEDIA_UPLOAD_MAX_BYTES, error: MEDIA_UPLOAD_TOO_LARGE_ERROR };
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

/**
 * The per-file BUFFER check, shared by a single bytes upload and each batch
 * item: `bytes` must be a non-empty `ArrayBuffer` and a present `mimeType` a
 * string. Returns the refusal, or `null`.
 */
function mediaBytesShapeError(bytes: unknown, mimeType: unknown): string | null {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) return MEDIA_UPLOAD_INVALID_ERROR;
  if (mimeType !== undefined && typeof mimeType !== 'string') return MEDIA_UPLOAD_INVALID_ERROR;
  return null;
}

/**
 * The per-file CONTENT checks, shared by a single bytes upload and each batch
 * item, in the host's order: the sniffed content must be one of the kind's
 * types, then a present `mimeType` (normalised) must equal the sniffed type.
 */
function mediaContentVerdict(
  kind: BlockMediaKind,
  bytes: ArrayBuffer,
  mimeType: unknown,
): { ok: true; mimeType: string } | { ok: false; error: string } {
  const sniffed = sniffMediaBytes(kind, new Uint8Array(bytes));
  if (!sniffed) return { ok: false, error: MEDIA_UPLOAD_TYPE_ERROR[kind] };
  if (typeof mimeType === 'string' && normaliseMediaMimeType(mimeType) !== sniffed) {
    return { ok: false, error: MEDIA_UPLOAD_MIME_MISMATCH_ERROR };
  }
  return { ok: true, mimeType: sniffed };
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
 *   4. no block token (`opts.noToken`) → `no block token`, before the cap
 *      and the window;
 *   5. over the kind's cap ({@link mediaUploadCap}: 24 MiB for an image,
 *      64 MiB for video and audio) → too large, before the window, so an
 *      over-cap file is never `busy` (a retry could never succeed);
 *   6. the window, NOT recording, so a full window refuses `busy` before any
 *      sniffing;
 *   7. the sniffed content in the kind's set → else the kind's type error;
 *   8. a present `mimeType` (normalised) equal to the sniffed type → else
 *      mismatch;
 *   9. record the upload in the window. Only an upload that will run counts.
 * Returns the pruned window to store back.
 */
export function admitMediaUpload(
  raw: { kind?: unknown; purpose?: unknown; bytes?: unknown; mimeType?: unknown },
  recent: readonly MediaUploadWindowEntry[],
  now: number,
  opts: { noToken?: boolean } = {},
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

  const shapeError = mediaBytesShapeError(raw.bytes, raw.mimeType);
  if (shapeError) return refuse(shapeError);
  const bytes = raw.bytes as ArrayBuffer;
  const size = bytes.byteLength;
  if (opts.noToken) return refuse(MEDIA_UPLOAD_NO_TOKEN_ERROR);
  const cap = mediaUploadCap(kind);
  if (size > cap.maxBytes) return refuse(cap.error);
  if (!windowHasRoom(live, size)) return refuse(MEDIA_UPLOAD_BUSY_ERROR);
  const content = mediaContentVerdict(kind, bytes, raw.mimeType);
  if (!content.ok) return refuse(content.error);
  return {
    result: { ok: true, mode: 'bytes', kind, bytes, mimeType: content.mimeType },
    recent: [...live, { at: now, size }],
  };
}

/** One batch item as the host reads it off the wire (nothing about it is trusted). */
export type MediaUploadBatchWireItem = { kind?: unknown; bytes?: unknown; mimeType?: unknown };

/**
 * The host's WHOLE-BATCH refusal for one `OPEN_MEDIA_UPLOAD_BATCH`, or `null`
 * when the request is admissible as a batch. ONE place for these rules: both
 * `useMediaUpload().uploadBatch` (before sending) and the mock host call it.
 * In the host's order:
 *   1. `items` not an array, or an entry not an object → invalid batch;
 *   2. `purpose` not `'generationSource'` → purpose error;
 *   3. fewer than 1 or more than {@link MEDIA_UPLOAD_BATCH_MAX_ITEMS} items →
 *      count error;
 *   4. the items' raw bytes (every entry whose `bytes` is an `ArrayBuffer`)
 *      over {@link MEDIA_UPLOAD_BATCH_MAX_BYTES} → too large.
 * A problem with ONE item (an unknown kind, a bad buffer, a file over its cap,
 * the wrong content) is NOT a whole-batch refusal: it is answered in that
 * item's own result ({@link admitMediaUploadBatchItem}).
 */
export function mediaUploadBatchRefusal(raw: { purpose?: unknown; items?: unknown }): string | null {
  const items = raw.items;
  if (!Array.isArray(items)) return MEDIA_UPLOAD_BATCH_INVALID_ERROR;
  for (const item of items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return MEDIA_UPLOAD_BATCH_INVALID_ERROR;
  }
  if (raw.purpose !== 'generationSource') return MEDIA_UPLOAD_PURPOSE_ERROR;
  if (items.length < 1 || items.length > MEDIA_UPLOAD_BATCH_MAX_ITEMS) return MEDIA_UPLOAD_BATCH_COUNT_ERROR;
  let total = 0;
  for (const item of items as MediaUploadBatchWireItem[]) {
    if (item.bytes instanceof ArrayBuffer) total += item.bytes.byteLength;
  }
  if (total > MEDIA_UPLOAD_BATCH_MAX_BYTES) return MEDIA_UPLOAD_BATCH_TOO_LARGE_ERROR;
  return null;
}

/**
 * The host's decision for ONE item of an admissible batch: the single bytes
 * upload's per-file checks, in the same order, minus the token check (whole
 * batch) and minus the window (a batch has none):
 *   1. `kind` not known → kind error;
 *   2. `bytes` not a non-empty `ArrayBuffer`, or a non-string `mimeType` →
 *      invalid;
 *   3. over the kind's cap ({@link mediaUploadCap}) → too large;
 *   4. the sniffed content in the kind's set → else the kind's type error;
 *   5. a present `mimeType` (normalised) equal to the sniffed type → else
 *      mismatch.
 */
export function admitMediaUploadBatchItem(
  raw: MediaUploadBatchWireItem,
): { ok: true; kind: BlockMediaKind; bytes: ArrayBuffer; mimeType: string } | { ok: false; error: string } {
  if (!isMediaKind(raw.kind)) return { ok: false, error: MEDIA_UPLOAD_KIND_ERROR };
  const kind = raw.kind;
  const shapeError = mediaBytesShapeError(raw.bytes, raw.mimeType);
  if (shapeError) return { ok: false, error: shapeError };
  const bytes = raw.bytes as ArrayBuffer;
  const cap = mediaUploadCap(kind);
  if (bytes.byteLength > cap.maxBytes) return { ok: false, error: cap.error };
  const content = mediaContentVerdict(kind, bytes, raw.mimeType);
  if (!content.ok) return content;
  return { ok: true, kind, bytes, mimeType: content.mimeType };
}

/**
 * The host's admission of one whole `OPEN_MEDIA_UPLOAD_BATCH` (the caller has
 * already dropped an unroutable `requestId`): the whole-batch refusal
 * ({@link mediaUploadBatchRefusal}), else one verdict per item, in item order
 * ({@link admitMediaUploadBatchItem}).
 */
export function admitMediaUploadBatch(raw: { purpose?: unknown; items?: unknown }):
  | { ok: false; error: string }
  | { ok: true; items: ReturnType<typeof admitMediaUploadBatchItem>[] } {
  const refusal = mediaUploadBatchRefusal(raw);
  if (refusal) return { ok: false, error: refusal };
  return { ok: true, items: (raw.items as MediaUploadBatchWireItem[]).map(admitMediaUploadBatchItem) };
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
 *    on the host. ONE value is placed where the host checks it instead:
 *    `no block token` refuses a bytes upload right after the buffer check,
 *    before the cap and the window, and is not counted.
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
  const admitted = admitMediaUpload(args.payload, args.recent, args.now, {
    noToken: args.forcedError === MEDIA_UPLOAD_NO_TOKEN_ERROR,
  });
  const { result, recent } = admitted;
  if (!result.ok) return { reply: { error: result.error }, recent };
  if (args.forcedError !== undefined) return { reply: { error: args.forcedError }, recent };
  // A kind left out of `canned` answers the default; one set to `null` dismisses.
  const configured = args.canned[result.kind];
  const canned = configured === undefined ? DEFAULT_MOCK_MEDIA_UPLOADS[result.kind] : configured;
  if (result.mode === 'picker') {
    return { reply: canned ? { selected: { ...canned, kind: result.kind } } : {}, recent };
  }
  return { reply: { selected: mockBytesUpload(args.canned, result.kind, result.mimeType, result.bytes) }, recent };
}

/**
 * What the mock reports for an ADMITTED bytes upload (single or batch item):
 * the kind's canned upload (the default when it is left out or `null`: there
 * is no picker to dismiss), carrying what the host would report for THESE
 * bytes: the sniffed `mimeType` and the buffer's size for video and audio;
 * `image/jpeg` and the canned size for an image, which the host re-encodes.
 */
function mockBytesUpload(
  canned: MockMediaUploads,
  kind: BlockMediaKind,
  sniffedMimeType: string,
  bytes: ArrayBuffer,
): BlockMediaUploadInfo {
  const base = canned[kind] ?? DEFAULT_MOCK_MEDIA_UPLOADS[kind];
  return kind === 'image'
    ? { ...base, kind: 'image', mimeType: 'image/jpeg' }
    : { ...base, kind, mimeType: sniffedMimeType, sizeBytes: bytes.byteLength };
}

/**
 * The mock host's whole answer to one routable `OPEN_MEDIA_UPLOAD_BATCH`, on a
 * page surface, in this order:
 *  1. the whole-batch refusal ({@link mediaUploadBatchRefusal}) → `{ error }`;
 *  2. `forcedError`, when set → `{ error }`: the stand-in for the whole-batch
 *     refusals the mock cannot produce (`no block token`, `busy` — the mock
 *     answers at once, so a batch is never still running when the next one
 *     arrives — the viewer's daily quota, the feature not available, a failure
 *     starting the batch). Placed after the request checks, before any item is
 *     looked at;
 *  3. every item's verdict ({@link admitMediaUploadBatchItem}). When NO item
 *     is valid the host answers the per-item errors without asking the viewer,
 *     so `declined` does not apply;
 *  4. `declined` → a bare reply (the viewer declined the host's confirm);
 *  5. otherwise `{ results, expiresAt }`: one entry per item, in item order,
 *     each the kind's canned upload ({@link mockBytesUpload}) or the item's
 *     refusal, and `expiresAt` = `now` + 7 days.
 * A batch never reads or writes the single bytes-mode window.
 */
export function mockMediaUploadBatchReply(args: {
  payload: { purpose?: unknown; items?: unknown };
  canned: MockMediaUploads;
  forcedError: string | undefined;
  declined: boolean;
  now: number;
}):
  | { error: string }
  | { results: BlockMediaUploadBatchItemResult[]; expiresAt: string }
  | Record<string, never> {
  const admitted = admitMediaUploadBatch(args.payload);
  if (!admitted.ok) return { error: admitted.error };
  if (args.forcedError !== undefined) return { error: args.forcedError };
  const anyValid = admitted.items.some((item) => item.ok);
  if (anyValid && args.declined) return {};
  const results = admitted.items.map((item, index): BlockMediaUploadBatchItemResult =>
    item.ok
      ? { index, selected: mockBytesUpload(args.canned, item.kind, item.mimeType, item.bytes) }
      : { index, error: item.error },
  );
  return { results, expiresAt: new Date(args.now + MEDIA_UPLOAD_BATCH_RETENTION_MS).toISOString() };
}
