import { useCallback } from 'react';

import type { BlockUploadedImageInfo } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';
import { PICKER_REQUEST_TIMEOUT_MS } from './useCheckpointPicker.js';

/**
 * Drives the platform-side image-upload flow for App Blocks (Design 1 —
 * host-chrome). Mirrors {@link useResourcePicker}: `open` asks the host to open
 * its OWN native upload modal; the iframe never handles the bytes. The upload
 * routes through civitai's session-authed scan pipeline (real `createImage` +
 * `ingestImage`) and a hard SFW + no-moderation-flag gate — so the host returns
 * ONLY a MODERATED image (scanned clean, within the SFW ceiling, unflagged).
 *
 * Resolves with the chosen {@link BlockUploadedImageInfo}, or `null` when the
 * user dismissed the modal without a successful upload. The returned `url` is a
 * Civitai-hosted image URL usable directly as a `WorkflowBody.sourceImage.url`
 * (img2img) — feed `{ url, width, height }` into the generation body and submit.
 *
 * Human-interactive, so it uses the same generous {@link PICKER_REQUEST_TIMEOUT_MS}
 * as the pickers (the host still resolves earlier on upload/dismiss/close).
 * Host-mediated, same trust model as `useResourcePicker` / `useBuzzWorkflow`.
 *
 * @example
 * const { open } = useImageUpload();
 * const img = await open();
 * if (!img) return;                       // user dismissed
 * // img2img: feed the moderated image into the generation body
 * await submit({ kind: 'textToImage', modelId, modelVersionId,
 *   sourceImage: { url: img.url, width: 1024, height: 1024 }, params: { prompt } });
 */
export function useImageUpload(): { open: () => Promise<BlockUploadedImageInfo | null> } {
  const open = useCallback(async () => {
    const { selected } = await sendTypedRequest(
      getTransport(),
      { type: 'OPEN_IMAGE_UPLOAD', payload: {} },
      'IMAGE_UPLOAD_RESULT',
      { timeoutMs: PICKER_REQUEST_TIMEOUT_MS },
    );
    // Normalize the "dismissed" case to an explicit null so callers can
    // `if (!img) return;` without an `undefined` ambiguity.
    return selected ?? null;
  }, []);

  return { open };
}
