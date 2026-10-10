import { useCallback } from 'react';

import type { BlockUploadedImageInfo } from '@civitai/app-sdk/blocks';

import { throwOnReplyError } from '../internal/replyError.js';
import { UPLOAD_BYTES_MAX_BYTES, UPLOAD_BYTES_TOO_LARGE_ERROR } from '../internal/uploadBytes.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';

/**
 * The SDK's own rejection when a reply carries neither an image nor an
 * `error`. A host that predates the `bytes` variant opens its picker instead,
 * and a dismissed picker replies this way; so does any reply whose `selected`
 * is not the moderated `display` shape.
 */
export const UPLOAD_IMAGE_BYTES_NO_IMAGE_ERROR = 'the host returned no uploaded image';

/** Options for {@link UseUploadImageBytes.upload}. */
export interface UploadImageBytesOptions {
  /**
   * Advisory name for the stored image. The host sanitises it with the same
   * rules as a `useSaveImage()` bytes name, forces the extension from the
   * sniffed type, and caps it at 255 characters.
   */
  filename?: string;
}

/** What {@link useUploadImageBytes} returns. */
export interface UseUploadImageBytes {
  /**
   * Upload an image the block produced in the tab, with no picker, and resolve
   * with the moderated image: the same {@link BlockUploadedImageInfo} a picked
   * `useImageUpload()` upload returns. Its `imageId` is postable by THIS app
   * through `useCreatePostFromApp()` as `{ kind: 'published', imageIds }`.
   *
   * REJECTS with the host's error string on every refusal or failure:
   * `invalid image-upload request` (not a non-empty `ArrayBuffer`),
   * `file exceeds the maximum upload size`, `file type is not allowed`,
   * `busy` (the host's rolling window is full; retry later), `no block token`,
   * or a server message passed through verbatim (a missing `posts:write:self`
   * scope, the posting flag, page-only, a rate limit, a scan refusal or
   * timeout), or `unsupported on this host` on a slot (model) host, which has
   * no handler and answers at once with its generic refusal. Rejects with
   * `the host returned no uploaded image` when a reply carries neither an image
   * nor an error.
   *
   * 🔴 With NO reply inside the 10-minute bound it rejects with a
   * `RequestTimeoutError` instead, and the work may have completed: the host
   * may have stored and scanned the image. Retrying after a timeout can create
   * a duplicate image.
   *
   * 🔴 One call is refused BEFORE sending, with the host's own string: a buffer
   * over the 40 MiB cap rejects with `file exceeds the maximum upload size`,
   * so it is never copied across `postMessage` just to be refused.
   */
  upload: (bytes: ArrayBuffer, options?: UploadImageBytesOptions) => Promise<BlockUploadedImageInfo>;
}

/**
 * Upload an image the block PRODUCED IN THE VIEWER'S TAB (a healed PNG, an
 * edited render) through the host's `OPEN_IMAGE_UPLOAD { bytes }` bridge, so
 * the app can then post it. No picker opens; the host runs the same store
 * upload → persist → scan pipeline as a picked `display` upload and replies
 * only once the scan settles.
 *
 * - 🔴 **Page apps only** (a slot host rejects at once with
 *   `unsupported on this host`), and the token needs **`posts:write:self`**
 *   (the server refuses the persist without it). This hook does not prompt for the
 *   scope, so ask for it first with `useRequestConsent()`: the upload runs
 *   before any `useCreatePostFromApp()` call that would otherwise prompt.
 * - **Images only:** PNG, WebP or JPEG by magic bytes. The cap is 40 MiB, and
 *   the host also allows at most 3 uploads and 80 MiB per 60 s per page.
 * - The buffer is COPIED across `postMessage`, never transferred, so the block
 *   can keep displaying it. Pass an `ArrayBuffer` (`await blob.arrayBuffer()`),
 *   not a `Blob` or a typed array, which the host refuses.
 * - 🔴 **A host that predates the variant ignores `bytes` and opens its picker.**
 *   Then the promise settles on whatever the viewer picks, or rejects with
 *   `the host returned no uploaded image` on a dismiss. It needs
 *   civitai/civitai#5639 merged and deployed to civitai.com; that PR is still
 *   changing, so no intermediate head of it is enough. Do not ship a block
 *   relying on this before then.
 *
 * Under `createMockHost` / `Harness` the host's admission rules are modelled
 * (see `MockHostOptions.uploadImageBytesResult`). `dev:live` has no bytes
 * path: it replies dismissed, so `upload` rejects with
 * `the host returned no uploaded image`.
 *
 * @example
 * const { upload } = useUploadImageBytes();
 * const { createPost } = useCreatePostFromApp();
 * const image = await upload(await healed.arrayBuffer(), { filename: 'healed.png' });
 * await createPost({ sources: [{ kind: 'published', imageIds: [image.imageId] }] });
 */
export function useUploadImageBytes(): UseUploadImageBytes {
  const upload = useCallback(
    async (bytes: ArrayBuffer, options?: UploadImageBytesOptions): Promise<BlockUploadedImageInfo> => {
      // The ONLY client-side refusal, mirroring `useSaveImage`'s cap pre-check:
      // everything else is forwarded and judged by the host.
      if (bytes instanceof ArrayBuffer && bytes.byteLength > UPLOAD_BYTES_MAX_BYTES) {
        throw new Error(UPLOAD_BYTES_TOO_LARGE_ERROR);
      }
      const reply = await sendTypedRequest(
        getTransport(),
        {
          type: 'OPEN_IMAGE_UPLOAD',
          payload: {
            bytes,
            ...(options?.filename !== undefined ? { filename: options.filename } : {}),
          },
        },
        'IMAGE_UPLOAD_RESULT',
        // `OPEN_IMAGE_UPLOAD` is bucketed `'human'` (transport/requestTimeouts.ts),
        // and this variant needs the long bound too: the host replies only after
        // the store upload, the persist and a scan poll of up to three minutes,
        // and a host that predates `bytes` opens a picker a person must close.
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      // No `ok` on this reply, so the presence-based helper (internal/replyError.ts).
      throwOnReplyError(reply, 'image upload failed');
      const selected = reply.selected;
      if (selected && !('status' in selected) && 'imageId' in selected) return selected;
      throw new Error(UPLOAD_IMAGE_BYTES_NO_IMAGE_ERROR);
    },
    [],
  );

  return { upload };
}
