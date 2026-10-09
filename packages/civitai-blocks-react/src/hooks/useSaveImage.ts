import { useCallback } from 'react';

import { SAVE_BYTES_MAX_BYTES } from '@civitai/app-sdk/blocks';

import { getTransport } from '../transport/singleton.js';
import { throwOnFailedReply } from '../internal/replyError.js';
import { SAVE_BYTES_TOO_LARGE_ERROR, SAVE_IMAGE_INVALID_REQUEST_ERROR } from '../internal/saveBytes.js';
import { sendTypedRequest } from '../transport/transport.js';

/**
 * Input to {@link UseSaveImage.saveImage}. Exactly ONE of `url` / `imageId` /
 * `bytes` is required — the three variants map to the host's three download
 * paths, each with its own security gate:
 *
 *  - `{ url }` — the block's OWN fresh output (e.g. an orchestration blob it has
 *    no `imageId` for yet). The host ALLOWLISTS the URL's origin to the civitai
 *    image/blob CDN and refuses an arbitrary host — a sandboxed block can't
 *    coerce a host-side fetch of an attacker origin.
 *  - `{ imageId }` — a cross-user grid image (e.g. a benchmark cell). The host
 *    resolves it through the SAME per-viewer gated read that backs
 *    `useGatedImages()`, so a withheld/above-ceiling image can never be saved.
 *  - `{ bytes }` — a file the block PRODUCED IN THE VIEWER'S TAB (a healed
 *    image, a JSON sidecar, a text export) that exists nowhere else. 🔴 **This
 *    is the sanctioned way for an in-tab tool to deliver a file.** A blob-anchor
 *    `<a download>` does nothing in a block — its sandbox lacks
 *    `allow-downloads`, and the validator refuses that token for unverified
 *    blocks — so do not build one. 🔴 **Page apps only**; a slot block's host
 *    refuses it.
 *
 *    The host classifies by CONTENT and never trusts `mimeType` or `filename`:
 *    PNG / WebP / JPEG by magic bytes; otherwise valid UTF-8 with no NUL byte,
 *    saved as JSON when it parses AND the hint (`mimeType: 'application/json'`
 *    or a `.json` filename) says json, else as text/plain. Anything else — a
 *    GIF, a zip, random binary — is refused with `file type is not allowed`.
 *    The saved extension is forced from the classified type, whatever
 *    `filename` says. The cap is `SAVE_BYTES_MAX_BYTES` (50 MiB) of raw bytes.
 *    The buffer is COPIED across `postMessage`, never transferred, so the block
 *    can keep displaying it.
 */
export type SaveImageInput =
  | { url: string; imageId?: never; bytes?: never; filename?: string }
  | { imageId: number; url?: never; bytes?: never; filename?: string }
  | {
      bytes: ArrayBuffer;
      /** A HINT — `'application/json'` selects JSON for bytes that parse as JSON. Never trusted. */
      mimeType?: string;
      filename?: string;
      url?: never;
      imageId?: never;
    };

export interface UseSaveImage {
  /**
   * Ask the host to DOWNLOAD a file — an image the block already displays, or
   * bytes it produced in the tab — in the host's unsandboxed top frame, which
   * triggers the browser "Save As". A sandboxed opaque-origin block lacks
   * `allow-downloads`, so this bridge is the only way a block can save a file.
   * Resolves once the host has started the download; rejects with the host's
   * error string on failure (a disallowed URL origin, a withheld image, a
   * disallowed file type, an over-size file, a fetch failure, or `busy`), or
   * the transport timeout — the hook never hangs.
   *
   * 🔴 Some calls are refused BEFORE sending, with the host's own strings:
   * `invalid save-image request` when not exactly one of `url` / `imageId` /
   * `bytes` is set, or when `bytes` is not an `ArrayBuffer` (pass an
   * `ArrayBuffer` — `await blob.arrayBuffer()`, or `view.slice().buffer` for a
   * typed array — not the `Uint8Array` or `Blob` itself); and
   * `file exceeds the maximum save size` over the cap. On a host
   * that predates the `bytes` variant the HOST replies `invalid save-image
   * request`; treat that string as "this host cannot save bytes yet".
   */
  saveImage: (input: SaveImageInput) => Promise<void>;
}

type SaveImageWirePayload = {
  url?: string;
  imageId?: number;
  bytes?: ArrayBuffer;
  mimeType?: string;
  filename?: string;
};

/**
 * Build the wire payload, or throw the host's own error string for an input the
 * host would refuse. The `bytes` checks run client-side so an over-cap buffer
 * is never copied across `postMessage` just to be refused.
 */
function toWirePayload(input: SaveImageInput): SaveImageWirePayload {
  const raw = input as { url?: unknown; imageId?: unknown; bytes?: unknown };
  const variants =
    (raw.url !== undefined ? 1 : 0) + (raw.imageId !== undefined ? 1 : 0) + (raw.bytes !== undefined ? 1 : 0);
  // Exactly one variant — the same rule, and the same string, as the host.
  if (variants !== 1) throw new Error(SAVE_IMAGE_INVALID_REQUEST_ERROR);
  if (raw.bytes !== undefined) {
    if (!(raw.bytes instanceof ArrayBuffer)) throw new Error(SAVE_IMAGE_INVALID_REQUEST_ERROR);
    if (raw.bytes.byteLength > SAVE_BYTES_MAX_BYTES) {
      throw new Error(SAVE_BYTES_TOO_LARGE_ERROR);
    }
    const { mimeType, filename } = input as { mimeType?: string; filename?: string };
    return { bytes: raw.bytes, mimeType, filename };
  }
  if (input.url !== undefined) return { url: input.url, filename: input.filename };
  return { imageId: (input as { imageId: number }).imageId, filename: input.filename };
}

/**
 * Download a file via the host-mediated `SAVE_IMAGE` → `SAVE_IMAGE_RESULT`
 * bridge. See {@link SaveImageInput} for the security posture of each variant.
 *
 * @example
 * const { saveImage } = useSaveImage();
 * // block's own generation output (origin-allowlisted host-side):
 * await saveImage({ url: output.url, filename: 'my-render.png' });
 * // a cross-user grid cell (routed through the gated per-viewer read):
 * await saveImage({ imageId: cell.imageId });
 * // a file produced in the tab (classified by content host-side; page apps only):
 * await saveImage({ bytes: healedPng, filename: 'healed.png' });
 */
export function useSaveImage(): UseSaveImage {
  const saveImage = useCallback(async (input: SaveImageInput): Promise<void> => {
    const payload = toWirePayload(input);
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'SAVE_IMAGE', payload },
      'SAVE_IMAGE_RESULT',
    );
    throwOnFailedReply(reply, 'failed to save image');
  }, []);

  return { saveImage };
}
