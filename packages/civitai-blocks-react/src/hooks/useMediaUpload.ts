import { useCallback } from 'react';

import type { BlockMediaKind, BlockMediaUploadInfo } from '@civitai/app-sdk/blocks';

import {
  MEDIA_UPLOAD_INVALID_ERROR,
  MEDIA_UPLOAD_KIND_ERROR,
  isMediaKind,
  mediaUploadCap,
} from '../internal/mediaUploadBytes.js';
import { throwOnReplyError } from '../internal/replyError.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
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

  return { open, upload };
}
