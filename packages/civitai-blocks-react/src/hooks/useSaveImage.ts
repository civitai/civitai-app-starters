import { useCallback } from 'react';

import { getTransport } from '../transport/singleton.js';
import { throwOnFailedReply } from '../internal/replyError.js';
import { SAVE_BYTES_MAX_BYTES, SAVE_BYTES_TOO_LARGE_ERROR } from '../internal/saveBytes.js';
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
 *    blocks — so do not build one. 🔴 **Page apps only**: a slot (model) block's
 *    host has no `SAVE_IMAGE` handler, so its generic unhandled-request reply
 *    answers at once and the call rejects with `unsupported on this host`.
 *
 *    The host classifies by CONTENT and never trusts `filename` to make a file
 *    acceptable: PNG / WebP / JPEG by magic bytes; otherwise valid UTF-8 with
 *    no NUL byte, saved as JSON when it parses AND `filename` ends `.json`
 *    (case-insensitive) after the host replaces each `?` and `#` with `_` (so
 *    `data.json?v=2` saves as text), else as text/plain. Anything else — a GIF, a zip,
 *    random binary — is refused with `file type is not allowed`, and an empty
 *    buffer with `invalid save-image request`. The saved extension is forced
 *    from the classified type, whatever `filename` says. The cap is 50 MiB of
 *    raw bytes.
 *    The buffer is COPIED across `postMessage`, never transferred, so the block
 *    can keep displaying it.
 */
export type SaveImageInput =
  | { url: string; imageId?: never; bytes?: never; filename?: string }
  | { imageId: number; url?: never; bytes?: never; filename?: string }
  | { bytes: ArrayBuffer; url?: never; imageId?: never; filename?: string };

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
   * 🔴 One call is refused BEFORE sending, with the host's own string: a
   * `bytes` buffer over the 50 MiB cap rejects with `file exceeds the maximum
   * save size`, so it is never copied across `postMessage` just to be refused.
   * Everything else is forwarded and judged by the host, which replies
   * `invalid save-image request` to a request that is not exactly one variant,
   * to a `bytes` that is not a non-empty `ArrayBuffer` (pass
   * `await blob.arrayBuffer()`, or `view.slice().buffer` for a typed array —
   * not the `Uint8Array` or `Blob` itself), and, on a host that predates the
   * `bytes` variant, to every `bytes` save; treat that string as "this host
   * cannot save bytes yet".
   */
  saveImage: (input: SaveImageInput) => Promise<void>;
}

type SaveImageWirePayload = {
  url?: string;
  imageId?: number;
  bytes?: ArrayBuffer;
  filename?: string;
};

/**
 * Build the wire payload. The ONLY client-side refusal is the cap, so an
 * over-cap buffer is never copied across `postMessage` just to be refused.
 * Everything else is forwarded as given and the host judges it: a `bytes`
 * input is sent with whatever `url` / `imageId` came with it (the host refuses
 * the mix), and a `url` / `imageId` input keeps its pre-`bytes` behaviour
 * (`url` wins when both are set).
 */
function toWirePayload(input: SaveImageInput): SaveImageWirePayload {
  const raw = input as { url?: string; imageId?: number; bytes?: unknown; filename?: string };
  if (raw.bytes !== undefined) {
    if (raw.bytes instanceof ArrayBuffer && raw.bytes.byteLength > SAVE_BYTES_MAX_BYTES) {
      throw new Error(SAVE_BYTES_TOO_LARGE_ERROR);
    }
    const payload: SaveImageWirePayload = { bytes: raw.bytes as ArrayBuffer, filename: raw.filename };
    if (raw.url !== undefined) payload.url = raw.url;
    if (raw.imageId !== undefined) payload.imageId = raw.imageId;
    return payload;
  }
  return 'url' in input && input.url !== undefined
    ? { url: input.url, filename: input.filename }
    : { imageId: (input as { imageId: number }).imageId, filename: input.filename };
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
