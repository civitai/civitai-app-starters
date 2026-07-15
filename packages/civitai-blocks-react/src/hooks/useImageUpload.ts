import { useCallback } from 'react';

import type {
  BlockGenerationSourceImageInfo,
  BlockUploadedImageInfo,
  BlockUploadPurpose,
} from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';
import { PICKER_REQUEST_TIMEOUT_MS } from './useCheckpointPicker.js';

/** Options for {@link useImageUpload}. */
export interface UseImageUploadOptions {
  /**
   * Upload MODE (default `'display'`):
   *  - `'display'` — a PUBLIC image; the host returns a MODERATED
   *    {@link BlockUploadedImageInfo} (scanned clean, within the SFW ceiling).
   *  - `'generationSource'` — a PRIVATE img2img source; UNSCANNED, so the host
   *    returns ONLY the source shape {@link BlockGenerationSourceImageInfo}
   *    (`{ url, width, height }`).
   */
  purpose?: BlockUploadPurpose;
}

/**
 * Drives the platform-side image-upload flow for App Blocks (Design 1 —
 * host-chrome). Mirrors {@link useResourcePicker}: `open` asks the host to open
 * its OWN native upload modal; the iframe never handles the bytes. The upload
 * routes through civitai's session-authed pipeline; the host is what decides
 * how the image is scanned/returned based on the requested `purpose`.
 *
 * The RETURN of `open()` is typed by `purpose`:
 *  - default / `'display'` → resolves with a MODERATED
 *    {@link BlockUploadedImageInfo} (imageId/nsfwLevel/contentRating/url), or
 *    `null` when the user dismissed the modal without a successful upload. The
 *    returned `url` is a Civitai-hosted image URL usable directly as a
 *    `WorkflowBody.sourceImage.url`.
 *  - `'generationSource'` → resolves with the source
 *    {@link BlockGenerationSourceImageInfo} (`{ url, width, height }`, UNSCANNED —
 *    the orchestrator scans it at gen time), or `null` on dismiss. Feed it
 *    straight into a `WorkflowBody.sourceImage` for an img2img graph.
 *
 * Human-interactive, so it uses the same generous {@link PICKER_REQUEST_TIMEOUT_MS}
 * as the pickers (the host still resolves earlier on upload/dismiss/close).
 * Host-mediated, same trust model as `useResourcePicker` / `useBuzzWorkflow`.
 *
 * Backward-compatible: when `purpose` is omitted the hook sends NO `purpose`
 * field on `OPEN_IMAGE_UPLOAD`, so an older host (which normalizes an absent
 * purpose to `'display'`) behaves exactly as before.
 *
 * @example
 * // display (moderated public image) — default
 * const { open } = useImageUpload();
 * const img = await open();
 * if (!img) return;                       // user dismissed
 * await submit({ kind: 'textToImage', modelId, modelVersionId,
 *   sourceImage: { url: img.url, width: 1024, height: 1024 }, params: { prompt } });
 *
 * @example
 * // generationSource (private img2img source, unscanned)
 * const { open } = useImageUpload({ purpose: 'generationSource' });
 * const src = await open();               // { url, width, height } | null
 * if (!src) return;
 * await submit({ kind: 'textToImage', modelId, modelVersionId,
 *   sourceImage: src, params: { prompt } });
 */
export function useImageUpload(options: { purpose: 'generationSource' }): {
  open: () => Promise<BlockGenerationSourceImageInfo | null>;
};
export function useImageUpload(options?: { purpose?: 'display' }): {
  open: () => Promise<BlockUploadedImageInfo | null>;
};
export function useImageUpload(options?: UseImageUploadOptions): {
  open: () => Promise<BlockUploadedImageInfo | BlockGenerationSourceImageInfo | null>;
} {
  const purpose = options?.purpose;
  const open = useCallback(async () => {
    // Omit `purpose` for the default/display mode so the wire stays
    // byte-compatible with an older host that predates the field.
    const payload = purpose === 'generationSource' ? { purpose } : {};
    const { selected } = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_IMAGE_UPLOAD', payload },
      'IMAGE_UPLOAD_RESULT',
      { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
    );
    // Normalize the "dismissed" case to an explicit null so callers can
    // `if (!img) return;` without an `undefined` ambiguity.
    return selected ?? null;
  }, [purpose]);

  return { open };
}
