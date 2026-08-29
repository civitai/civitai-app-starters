import { useCallback } from 'react';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

/**
 * Input to {@link UseSaveImage.saveImage}. Exactly ONE of `url` / `imageId` is
 * required — the two variants map to the host's two download paths:
 *
 *  - `{ url }` — the block's OWN fresh output (e.g. an orchestration blob it has
 *    no `imageId` for yet). The host ALLOWLISTS the URL's origin to the civitai
 *    image/blob CDN and refuses an arbitrary host — a sandboxed block can't
 *    coerce a host-side fetch of an attacker origin.
 *  - `{ imageId }` — a cross-user grid image (e.g. a benchmark cell). The host
 *    resolves it through the SAME per-viewer gated read that backs
 *    `useGatedImages()`, so a withheld/above-ceiling image can never be saved.
 */
export type SaveImageInput =
  | { url: string; imageId?: never; filename?: string }
  | { imageId: number; url?: never; filename?: string };

export interface UseSaveImage {
  /**
   * Ask the host to DOWNLOAD an image the block already displays — the host
   * fetches the blob in its unsandboxed top frame and triggers the browser
   * "Save As". A sandboxed opaque-origin block lacks `allow-downloads`, so it
   * otherwise can only copy a URL; this bridge is the only way to save a paid
   * output. Resolves once the host has started the download; rejects with the
   * host's error string on failure (a disallowed URL origin, a withheld image,
   * an over-size blob, or a fetch failure), or the transport timeout — the hook
   * never hangs.
   */
  saveImage: (input: SaveImageInput) => Promise<void>;
}

/**
 * Download an image via the host-mediated `SAVE_IMAGE` → `SAVE_IMAGE_RESULT`
 * bridge. See {@link SaveImageInput} for the url-vs-id security posture.
 *
 * @example
 * const { saveImage } = useSaveImage();
 * // block's own generation output (origin-allowlisted host-side):
 * await saveImage({ url: output.url, filename: 'my-render.png' });
 * // a cross-user grid cell (routed through the gated per-viewer read):
 * await saveImage({ imageId: cell.imageId });
 */
export function useSaveImage(): UseSaveImage {
  const saveImage = useCallback(async (input: SaveImageInput): Promise<void> => {
    const payload: { url?: string; imageId?: number; filename?: string } =
      'url' in input && input.url !== undefined
        ? { url: input.url, filename: input.filename }
        : { imageId: (input as { imageId: number }).imageId, filename: input.filename };
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'SAVE_IMAGE', payload },
      'SAVE_IMAGE_RESULT',
    );
    // A PRESENT `error` is the reject signal, not a TRUTHY one: the reply
    // validator early-accepts anything carrying an `error` key, so `error: ''`
    // reaches here having skipped the success-field checks. `||` (not `??`) so
    // an empty error string still yields readable copy.
    if (!reply.ok || reply.error !== undefined) {
      throw new Error(reply.error || 'failed to save image');
    }
  }, []);

  return { saveImage };
}
