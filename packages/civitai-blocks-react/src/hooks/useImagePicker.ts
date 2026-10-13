import { useCallback } from 'react';

import type { BlockImagePickerSource, BlockPickedImageInfo } from '@civitai/app-sdk/blocks';

import { throwOnReplyError } from '../internal/replyError.js';
import { HUMAN_INTERACTION_TIMEOUT_MS } from '../transport/requestTimeouts.js';
import { getTransport } from '../transport/singleton.js';
import { sendTypedRequest } from '../transport/transport.js';
import { useTransportConnection } from './useTransportConnection.js';

/**
 * The most images ONE multi pick `open({ multiple })` can return. A larger
 * `multiple.max` is CLAMPED to this, here and again by the host.
 */
export const IMAGE_PICKER_MULTIPLE_MAX = 20;

/** The options every {@link UseImagePicker} `open` call takes. All optional. */
export interface ImagePickerOpenOptions {
  /**
   * Which of the viewer's libraries the picker offers: `'posted'` (images they
   * posted to Civitai), `'generated'` (outputs they made with the Civitai
   * generator), or both. OMIT it to offer both.
   *
   * An empty array or an unknown member rejects before anything is sent. A
   * repeated member is harmless.
   */
  sources?: BlockImagePickerSource[];
}

/**
 * Multi pick: let the viewer pick up to `max` images in ONE picker session.
 *
 * `max` is a whole number ≥ 1. Anything above
 * {@link IMAGE_PICKER_MULTIPLE_MAX} (20) is CLAMPED to it; anything that is not
 * a whole number ≥ 1 rejects before anything is sent.
 */
export interface ImagePickerMultiple {
  max: number;
}

/** What {@link useImagePicker} returns. */
export interface UseImagePicker {
  open: {
    /**
     * Single pick. Resolves with the chosen image, or `null` when the viewer
     * dismissed the picker. Rejects when the host refuses the request.
     */
    (opts?: ImagePickerOpenOptions & { multiple?: undefined }): Promise<BlockPickedImageInfo | null>;
    /**
     * Multi pick (see {@link ImagePickerMultiple}). Resolves with the picked
     * images, never more than `max`, or `[]` when the viewer dismissed. Each
     * entry is the same {@link BlockPickedImageInfo} a single pick returns.
     * Rejects when the host refuses the request.
     */
    (opts: ImagePickerOpenOptions & { multiple: ImagePickerMultiple }): Promise<BlockPickedImageInfo[]>;
  };
}

/** The two libraries the picker knows. Anything else is refused before sending. */
const IMAGE_PICKER_SOURCES: ReadonlySet<string> = new Set<BlockImagePickerSource>([
  'posted',
  'generated',
]);

/**
 * Lets the viewer pick one or more of their EXISTING Civitai images: the ones
 * they posted, and the ones they made with the Civitai generator.
 *
 * `open` asks the host to open its OWN picker over the viewer's library. The
 * viewer browses in host chrome; the block never lists the library and receives
 * only what the viewer picked, as {@link BlockPickedImageInfo}:
 * `{ source, url, width, height, nsfwLevel, imageId? }`. `imageId` is set for a
 * `'posted'` pick and absent for a `'generated'` one (a generator output that
 * was never posted has no image id). Images only.
 *
 * - Single pick (the default) resolves with the image, or `null` on dismiss.
 * - `multiple: { max }` resolves with a LIST of up to `max` images (at most
 *   {@link IMAGE_PICKER_MULTIPLE_MAX}), `[]` on dismiss.
 * - `sources` narrows the picker to one library. Omit it for both.
 *
 * What is pickable is decided by the host: the viewer's own posted images that
 * are published, scanned and unflagged, and their own succeeded generator
 * outputs that carry a rating, all within the same SFW ceiling an upload has to
 * clear. A signed-out viewer is sent to sign in and the call resolves as a
 * dismiss.
 *
 * A REFUSAL REJECTS; it is never a dismiss. `open` rejects with the host's
 * message when the host refuses the request, and with
 * `unsupported on this host` on a surface that does not offer the picker (it is
 * a page-app affordance). It also rejects, before sending anything, for an
 * empty or unknown `sources` and for a `multiple.max` that is not a whole
 * number ≥ 1.
 *
 * A host that predates the picker does not answer the request at all, so the
 * call rejects with `RequestTimeoutError` after the human-interaction timeout
 * ({@link HUMAN_INTERACTION_TIMEOUT_MS}, 10 minutes).
 *
 * `{ url, width, height }` of a pick is a valid generation `sourceImage`. The
 * generation body bounds each dimension to 64–2048 on its own, and a picked
 * image may be larger.
 *
 * 🔴 THE ORDER OF THE `@example` BLOCKS BELOW IS LOAD-BEARING — DO NOT MOVE
 * THE LAST ONE. `<civitai-developer-docs>/scripts/gen-appblocks-hooks.mjs` assigns
 * `jsdocExample` inside its tag loop, so on a hook with several `@example` tags
 * the LAST one wins and becomes the single published example whenever the README
 * fence is unavailable. The plain single pick is what most apps should copy, so
 * it is last.
 *
 * @example
 * // ONE LIBRARY — only the viewer's generator outputs.
 * const { open } = useImagePicker();
 * const output = await open({ sources: ['generated'] });
 * // output?.imageId is undefined: a generator output has no image id
 *
 * @example
 * // MULTI PICK — up to 5 images in one picker session.
 * const { open } = useImagePicker();
 * const images = await open({ multiple: { max: 5 } });
 * // [] when dismissed; otherwise 1 to 5 picks
 * const urls = images.map((image) => image.url);
 *
 * @example
 * // THE DEFAULT — one image, from either library.
 * const { open } = useImagePicker();
 * const image = await open();
 * if (image) {
 *   // image.url, image.width, image.height, image.nsfwLevel, image.source
 * }
 */
export function useImagePicker(): UseImagePicker {
  useTransportConnection();
  const open = useCallback(
    async (
      opts?: ImagePickerOpenOptions & { multiple?: ImagePickerMultiple | null },
    ): Promise<BlockPickedImageInfo | BlockPickedImageInfo[] | null> => {
      // Both checks run BEFORE anything is sent: the caller gets an error naming
      // the mistake instead of the host's refusal a round-trip later.
      const requestedSources: unknown = opts?.sources;
      if (requestedSources != null) {
        if (!Array.isArray(requestedSources) || requestedSources.length === 0) {
          throw new Error(
            "useImagePicker: `sources` must be a non-empty array of 'posted' and/or 'generated'. " +
              'Omit it to offer both.',
          );
        }
        const unknown = requestedSources.find(
          (source) => typeof source !== 'string' || !IMAGE_PICKER_SOURCES.has(source),
        );
        if (unknown !== undefined) {
          throw new Error(
            `useImagePicker: unknown \`sources\` entry "${String(unknown)}". ` +
              "The picker offers 'posted' and 'generated'.",
          );
        }
      }
      // OMIT the key when it was not given: an absent `sources` is what means
      // "both", and the wire stays the minimum the caller asked for.
      const sources =
        requestedSources != null ? { sources: [...(requestedSources as BlockImagePickerSource[])] } : {};

      if (opts?.multiple == null) {
        const result = await sendTypedRequest(
          getTransport(),
          { type: 'OPEN_IMAGE_PICKER', payload: { ...sources } },
          'IMAGE_PICKER_RESULT',
          { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
        );
        // 🔴 BEFORE reading `selected`. A refusal carries no `selected`, so
        // without this a refused request (or `unsupported on this host`) would
        // resolve `null` and read exactly like the viewer dismissing.
        throwOnReplyError(result, 'The host refused the image picker request.');
        // Normalize the "dismissed" case to an explicit null so callers can
        // `if (!image) return;` without an `undefined` ambiguity.
        return result.selected ?? null;
      }

      // ── Multi pick ────────────────────────────────────────────────────────
      const requestedMax: unknown = (opts.multiple as { max?: unknown }).max;
      if (typeof requestedMax !== 'number' || !Number.isInteger(requestedMax) || requestedMax < 1) {
        throw new Error(
          'useImagePicker: `multiple.max` must be a whole number of at least 1 ' +
            `(values above ${IMAGE_PICKER_MULTIPLE_MAX} are clamped to ${IMAGE_PICKER_MULTIPLE_MAX}).`,
        );
      }
      const max = Math.min(requestedMax, IMAGE_PICKER_MULTIPLE_MAX);

      const result = await sendTypedRequest(
        getTransport(),
        { type: 'OPEN_IMAGE_PICKER', payload: { ...sources, multiple: { max } } },
        'IMAGE_PICKER_RESULT',
        { timeoutMs: HUMAN_INTERACTION_TIMEOUT_MS },
      );
      throwOnReplyError(result, 'The host refused the multi-pick image picker request.');

      // The host answers a multi request with `selectedImages` (`[]` on
      // dismiss). A reply carrying only `selected` (or nothing) is still a list
      // here, of one or none, so the caller has ONE result shape to handle.
      const picked = Array.isArray(result.selectedImages)
        ? result.selectedImages
        : result.selected
          ? [result.selected]
          : [];
      // Belt: never hand back more than was asked for.
      return picked.slice(0, max);
    },
    [],
  ) as UseImagePicker['open'];

  return { open };
}
