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
   *  - `status: 'visible'` — the viewer may see the pixels: `url` plus
   *    `width`/`height` for grid layout. 🔴 TWO SHAPES. A RATED image also carries
   *    `nsfwLevel` + `contentRating`. The viewer's OWN image that nothing has
   *    rated yet carries `ratingPending: true` and NEITHER — render a "still
   *    processing" affordance, and NEVER substitute a default rating.
   *  - `status: 'hidden'` — the image exists but is withheld from THIS viewer
   *    (above ceiling / flagged / scan-refused, or someone else's not-yet-rated
   *    image): NO `url` is ever returned, so the block MUST render a
   *    blurred/placeholder cell for it. The block can never obtain an unclamped
   *    url for an image the viewer isn't allowed to see, and cannot tell the
   *    withholding reasons apart — that is deliberate, since distinguishing them
   *    would let a SFW viewer enumerate which cells of a shared grid are mature.
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
 * returns each image as `visible` (url, plus a rating UNLESS it is the viewer's
 * own not-yet-rated image) or `hidden` (NO url — above ceiling / flagged /
 * scan-refused / someone else's unrated image). This is the load-bearing
 * cross-user moderation boundary: an unclamped edge URL never crosses to a viewer
 * who can't see the image, and the block must render a placeholder for any
 * `hidden` entry.
 *
 * 🔴 `nsfwLevel` AND `contentRating` ARE OPTIONAL, AND A MISSING ONE IS NOT "G".
 * They are absent exactly when `ratingPending` is present. Treating absent as a
 * safe default is the bug this state exists to stop: an image published seconds
 * earlier came back `hidden` under the old two-state contract and a grid rendered
 * it as *"Hidden — rated mature"*, a maturity claim about an image nothing had
 * rated, which a page reload then contradicted.
 *
 * @example
 * const { getImages } = useGatedImages();
 * const images = await getImages([101, 102, 103]);
 * for (const image of images) {
 *   if (image.status === 'hidden') renderPlaceholder(image.imageId);
 *   else if (image.ratingPending) renderStillProcessing(image.url); // NO rating to show
 *   else renderRated(image.url, image.contentRating);
 * }
 */
export function useGatedImages(): UseGatedImages {
  const getImages = useCallback(async (imageIds: number[]): Promise<BlockGatedImage[]> => {
    const reply = await sendTypedRequest(
      getTransport(),
      { type: 'GET_IMAGES_BY_IDS', payload: { imageIds } },
      'IMAGES_RESULT',
    );
    if (reply.error || !reply.result) {
      // `||`, not `??`: `isValidImagesResult` gates `error` on SHAPE only, so a host
      // `error: ''` is a VALID reply that reaches here. `??` replaces only
      // null/undefined, so it would throw an Error with an EMPTY message.
      throw new Error(reply.error || 'failed to fetch gated images');
    }
    return reply.result.images;
  }, []);

  return { getImages };
}
