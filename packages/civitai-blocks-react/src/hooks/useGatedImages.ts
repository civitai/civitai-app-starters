import { useCallback } from 'react';

import type { BlockGatedImage } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';

export type { BlockGatedImage };

/**
 * What {@link useGatedImages} returns.
 */
export interface UseGatedImages {
  /**
   * Ask the host for per-VIEWER gated display data for a list of image ids, and
   * resolve with a {@link BlockGatedImage} per resolvable id.
   *
   * The host applies the REQUESTING VIEWER's browsing-level clamp server-side, so
   * the shape a viewer receives depends on THEIR ceiling:
   *  - `status: 'visible'` — scanned clean + within ceiling + unflagged: the full
   *    moderated projection incl. `url` and `width`/`height` for grid layout.
   *  - `status: 'hidden'` — the image exists but is withheld from THIS viewer
   *    (above ceiling / not-yet-scanned / flagged): NO `url` is ever returned, so
   *    the block MUST render a blurred/placeholder cell for it. The block can
   *    never obtain an unclamped url for an image the viewer isn't allowed to see.
   *
   * Ids the host can't resolve to a benchmark-eligible bare `Image` row are
   * OMITTED entirely (neither visible nor hidden), so the returned array MAY be
   * shorter than `imageIds`. Rejects with the host's free-text error on failure,
   * or the transport timeout — the hook never hangs.
   */
  getImages: (imageIds: number[]) => Promise<BlockGatedImage[]>;
}

/**
 * Read per-viewer gated display data for a list of image ids via the
 * host-mediated `GET_IMAGES_BY_IDS` → `IMAGES_RESULT` bridge — the read side of
 * a cross-user image grid (e.g. ids stored via `useSharedStorage()`).
 *
 * The host applies the requesting viewer's browsing-level clamp server-side and
 * returns each image as `visible` (moderated projection incl. url) or `hidden`
 * (NO url — above ceiling / unscanned / flagged). This is the load-bearing
 * cross-user moderation boundary: an unclamped edge URL never crosses to a viewer
 * who can't see the image, and the block must render a placeholder for any
 * `hidden` entry.
 *
 * @example
 * const { getImages } = useGatedImages();
 * const images = await getImages([101, 102, 103]);
 * // …render `visible` cells with their url; `hidden` cells as a blurred placeholder.
 */
export function useGatedImages(): UseGatedImages {
  const getImages = useCallback(async (imageIds: number[]): Promise<BlockGatedImage[]> => {
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'GET_IMAGES_BY_IDS', payload: { imageIds } },
      'IMAGES_RESULT',
    );
    if (reply.error || !reply.result) {
      throw new Error(reply.error ?? 'failed to fetch gated images');
    }
    return reply.result.images;
  }, []);

  return { getImages };
}
