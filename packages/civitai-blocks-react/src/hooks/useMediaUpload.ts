import { useCallback } from 'react';

import type {
  BlockMediaKind,
  BlockMediaUploadBatchItemResult,
  BlockMediaUploadInfo,
} from '@civitai/app-sdk/blocks';

import {
  MEDIA_UPLOAD_INVALID_ERROR,
  MEDIA_UPLOAD_KIND_ERROR,
  isMediaKind,
  mediaUploadBatchRefusal,
  mediaUploadCap,
} from '../internal/mediaUploadBytes.js';
import { throwOnReplyError } from '../internal/replyError.js';
import {
  HUMAN_INTERACTION_TIMEOUT_MS,
  MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS,
} from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useTransportConnection } from './useTransportConnection.js';

/**
 * What `upload()` rejects with when the host answers with neither a file nor
 * an error. For a bytes upload that means the host DECLINED it without trying
 * (the app is viewed in review mode, or is not ready yet). Nothing was
 * uploaded, so it must never read as a success.
 */
export const MEDIA_UPLOAD_DECLINED_ERROR =
  'the host did not upload the media (the app is in review mode or not ready)';

/** Options for {@link UseMediaUpload.open}. */
export interface MediaUploadOpenOptions {
  /** What the viewer picks: `'image'`, `'video'` or `'audio'`. */
  kind: BlockMediaKind;
}

/** Options for {@link UseMediaUpload.upload}. */
export interface MediaUploadBytesOptions {
  /** What the bytes are: `'image'`, `'video'` or `'audio'`. */
  kind: BlockMediaKind;
  /**
   * The file, as an `ArrayBuffer` (`await blob.arrayBuffer()`). At most 24 MB
   * for an image and 64 MB for video or audio.
   * Copied across `postMessage`, never transferred. A `Blob`, a typed array or
   * an empty buffer is refused before sending.
   */
  bytes: ArrayBuffer;
  /**
   * Optional: the type you believe you are sending (`blob.type`). The host
   * decides the type from the content; when this is given and disagrees, the
   * upload is refused with `mimeType does not match the file's content`.
   * Parameters (`;codecs=…`) and case are ignored.
   */
  mimeType?: string;
}

/**
 * What `uploadBatch()` rejects with when the host's `results` do not line up
 * with the items sent: not exactly one entry per item, or an entry whose
 * `index` is not its position. The host never sends that; a reply that did
 * could pair a URL with the wrong item, so it is refused rather than returned.
 */
export const MEDIA_UPLOAD_BATCH_MISMATCH_ERROR =
  'the host answered the batch with results that do not match its items';

/** One item for {@link UseMediaUpload.uploadBatch}: the same fields as {@link MediaUploadBytesOptions}. */
export interface MediaUploadBatchItem {
  /** What the bytes are: `'image'`, `'video'` or `'audio'`. */
  kind: BlockMediaKind;
  /**
   * The file, as an `ArrayBuffer`. At most 24 MB for an image and 64 MB for
   * video or audio; a larger, empty or non-`ArrayBuffer` item is refused in
   * ITS OWN result, not before sending.
   */
  bytes: ArrayBuffer;
  /** Optional: the type you believe you are sending; must match the content. */
  mimeType?: string;
}

/** Options for {@link UseMediaUpload.uploadBatch}. */
export interface MediaUploadBatchOptions {
  /**
   * How long to wait for the host's one reply, in milliseconds. Default
   * {@link HUMAN_INTERACTION_TIMEOUT_MS} (10 minutes, for the viewer's confirm)
   * plus {@link MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS} (60 s) per item. This
   * REPLACES the whole bound.
   */
  timeoutMs?: number;
}

/** What {@link UseMediaUpload.uploadBatch} resolves with when the batch ran. */
export interface MediaUploadBatchResult {
  /**
   * Exactly one entry per item, in item order (`results[i].index === i`),
   * each with exactly one of `selected` (uploaded) and `error` (refused or
   * failed; the other items are unaffected).
   */
  results: BlockMediaUploadBatchItemResult[];
  /**
   * ISO 8601. The uploaded files are kept AT LEAST until then: at least 30
   * days, the upload service's default retention. Not a promise that they are
   * deleted at that time. Absent when no item was valid (nothing was uploaded).
   */
  expiresAt?: string;
}

/** What {@link useMediaUpload} returns. */
export interface UseMediaUpload {
  /**
   * PICKER mode: the host opens its own file picker for `kind`, uploads what
   * the viewer picks, and resolves with it. Resolves `null` when nothing was
   * uploaded: the viewer closed the picker, or the host declined at once
   * (review mode, not ready). Rejects with the host's message on a refusal.
   */
  open: (options: MediaUploadOpenOptions) => Promise<BlockMediaUploadInfo | null>;
  /**
   * BYTES mode: upload media the block holds (a canvas export, a crop, a
   * `MediaRecorder` recording) with no picker. Resolves with the uploaded
   * file. Rejects with the host's message on every refusal or failure, and
   * with {@link MEDIA_UPLOAD_DECLINED_ERROR} when the host declined without
   * uploading. It never resolves without a file.
   */
  upload: (options: MediaUploadBytesOptions) => Promise<BlockMediaUploadInfo>;
  /**
   * BATCH mode: upload 1 to 1200 files the block holds behind ONE confirm the
   * host shows the viewer, and get one answer per file. Resolves with
   * `{ results, expiresAt }` when the batch ran (some items may carry an
   * `error`), or `null` when nothing was uploaded because the viewer declined
   * the confirm or the host declined at once (review mode, not ready). Rejects
   * with the host's message when it refused the WHOLE batch (`busy`,
   * `no block token`, the daily quota, …), and before sending when the batch
   * itself is invalid (`invalid media-upload batch request`,
   * `a batch holds 1 to 1200 files`, `the batch exceeds the 10 GB limit`).
   */
  uploadBatch: (
    items: readonly MediaUploadBatchItem[],
    options?: MediaUploadBatchOptions,
  ) => Promise<MediaUploadBatchResult | null>;
}

/**
 * Upload an image, video or audio file as a GENERATION INPUT, and get back a
 * `url` to pass into a workflow step input.
 *
 * 🔴 THIS IS THE WAY TO PUT MEDIA INTO A STEP. The host refuses data URIs and
 * inline base64 in step inputs, so upload the file here and pass the returned
 * `url`.
 *
 * - `open({ kind })` lets the viewer pick a file in the host's own picker.
 * - `upload({ kind, bytes, mimeType? })` uploads bytes the block made in the
 *   tab, with no picker.
 *
 * The type is decided by the file's content: images PNG, JPEG or WebP (the
 * host resizes them to 64–2048 px per side and re-encodes them as JPEG);
 * videos MP4 or WebM; audio MP3, WAV or WebM. At most 24 MB per image (the
 * host decodes it in full before resizing) and 64 MB per video or audio; bytes
 * mode also allows at most 8 uploads and 128 MB per 60 s per page, and
 * rejects `busy` past that (retry later).
 *
 * Refused BEFORE sending, with the host's own strings: an unknown `kind`, an
 * `upload` whose `bytes` is not a non-empty `ArrayBuffer` (or whose `mimeType`
 * is not a string), and a buffer over the kind's cap.
 *
 * Page apps only: a model-slot host rejects with `unsupported on this host`.
 * A host that predates this message does not answer it, so the call rejects
 * with `RequestTimeoutError` after the human-interaction timeout
 * ({@link HUMAN_INTERACTION_TIMEOUT_MS}, 10 minutes).
 *
 * For images, `useImageUpload().open({ purpose: 'generationSource' })` remains
 * valid; this hook is the one that also takes video, audio and in-tab bytes.
 *
 * - `uploadBatch(items, { timeoutMs? })` uploads up to 1200 in-tab files
 *   behind one viewer confirm. The host checks every item with the
 *   single-file rules first and answers a refused item in its own result; it
 *   uploads at most 3 at a time, has no per-minute window (the 8-per-60 s
 *   window above is for `upload` only), and allows 1 to 1200 files and 10 GB
 *   in one batch, one batch at a time per page, and 1,200 files / 5 GB per
 *   viewer per UTC day across all apps. Uploads are kept for at least 30 days,
 *   the upload service's default retention (`expiresAt`).
 *
 * @example
 * // A recording made in the tab, passed into a step.
 * const { upload } = useMediaUpload();
 * const audio = await upload({ kind: 'audio', bytes: await recording.arrayBuffer(), mimeType: recording.type });
 * // audio.url goes into the step's audio input
 *
 * @example
 * // The viewer picks a video.
 * const { open } = useMediaUpload();
 * const video = await open({ kind: 'video' });
 * if (video) {
 *   // video.url, video.width, video.height, video.durationMs
 * }
 */
export function useMediaUpload(): UseMediaUpload {
  useTransportConnection();

  const open = useCallback(async ({ kind }: MediaUploadOpenOptions): Promise<BlockMediaUploadInfo | null> => {
    if (!isMediaKind(kind)) throw new Error(MEDIA_UPLOAD_KIND_ERROR);
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_MEDIA_UPLOAD', payload: { kind, purpose: 'generationSource' } },
      'MEDIA_UPLOAD_RESULT',
      // A person picks the file, and the reply waits for the upload.
      { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
    );
    // 🔴 BEFORE reading `selected`: a refusal carries none, and would
    // otherwise resolve `null` exactly like a dismiss.
    throwOnReplyError(reply, 'media upload failed');
    return reply.selected ?? null;
  }, []);

  const upload = useCallback(
    async ({ kind, bytes, mimeType }: MediaUploadBytesOptions): Promise<BlockMediaUploadInfo> => {
      // The host's own refusals, in the host's order, raised here so a doomed
      // buffer is never copied across postMessage.
      if (!isMediaKind(kind)) throw new Error(MEDIA_UPLOAD_KIND_ERROR);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
        throw new Error(MEDIA_UPLOAD_INVALID_ERROR);
      }
      if (mimeType !== undefined && typeof mimeType !== 'string') {
        throw new Error(MEDIA_UPLOAD_INVALID_ERROR);
      }
      const cap = mediaUploadCap(kind);
      if (bytes.byteLength > cap.maxBytes) throw new Error(cap.error);

      const reply = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_MEDIA_UPLOAD',
          payload: {
            kind,
            purpose: 'generationSource',
            bytes,
            ...(mimeType !== undefined ? { mimeType } : {}),
          },
        },
        'MEDIA_UPLOAD_RESULT',
        // `'human'` class: a 64 MB upload plus the host's retries can outlast
        // the default protocol timeout.
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      throwOnReplyError(reply, 'media upload failed');
      // A bare reply is the host declining (review mode / not ready). Nothing
      // was uploaded, so this is a failure, not a success.
      if (!reply.selected) throw new Error(MEDIA_UPLOAD_DECLINED_ERROR);
      return reply.selected;
    },
    [],
  );

  const uploadBatch = useCallback(
    async (
      items: readonly MediaUploadBatchItem[],
      options?: MediaUploadBatchOptions,
    ): Promise<MediaUploadBatchResult | null> => {
      // The host's WHOLE-BATCH refusals, in the host's order, from the one
      // shared rule (./internal/mediaUploadBytes.ts). A problem with one item
      // is NOT refused here: the host answers it in that item's result, so
      // the app gets a per-item answer, exactly as production gives it.
      const refusal = mediaUploadBatchRefusal({ purpose: 'generationSource', items });
      if (refusal) throw new Error(refusal);

      const reply = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_MEDIA_UPLOAD_BATCH',
          payload: {
            purpose: 'generationSource',
            items: items.map(({ kind, bytes, mimeType }) => ({
              kind,
              bytes,
              ...(mimeType !== undefined ? { mimeType } : {}),
            })),
          },
        },
        'MEDIA_UPLOAD_BATCH_RESULT',
        // The viewer answers a confirm, then the host uploads every file.
        {
          timeoutMs:
            options?.timeoutMs ?? HUMAN_INTERACTION_TIMEOUT_MS + MEDIA_UPLOAD_BATCH_PER_ITEM_TIMEOUT_MS * items.length,
        },
      );
      // 🔴 BEFORE reading `results`: a whole-batch refusal carries none, and
      // would otherwise resolve `null` exactly like a decline.
      throwOnReplyError(reply, 'media upload failed');
      // A bare reply: the viewer declined the confirm, or the host declined
      // at once. Nothing was uploaded; like `open`'s dismiss, not a failure.
      if (!reply.results) return null;
      const { results } = reply;
      if (results.length !== items.length || results.some((r, i) => r.index !== i)) {
        throw new Error(MEDIA_UPLOAD_BATCH_MISMATCH_ERROR);
      }
      return { results, ...(reply.expiresAt !== undefined ? { expiresAt: reply.expiresAt } : {}) };
    },
    [],
  );

  return { open, upload, uploadBatch };
}
