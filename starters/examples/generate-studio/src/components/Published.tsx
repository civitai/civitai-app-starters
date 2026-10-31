import { useEffect, useState } from 'react';

import { useGatedImages } from '@civitai/blocks-react';
import type { BlockGatedImage } from '@civitai/app-sdk/blocks';

import { OutputImage } from './OutputImage.js';

/**
 * Images this app PUBLISHED, read back through `useGatedImages().getImages(ids)`
 * — the per-viewer, server-clamped read any other viewer of a shared grid would
 * get. Three shapes, and each must render differently:
 *
 * - `hidden`  → NO url ever arrives; render a placeholder, never guess why.
 * - `visible` + `ratingPending` → the viewer's own image nothing has rated yet:
 *   there is NO rating, and a missing one is never "G".
 * - `visible` + `nsfwLevel` → rated; shown only if this viewer's level allows it.
 */
export function Published({ imageIds, blurMature }: { imageIds: number[]; blurMature: boolean }) {
  const { getImages } = useGatedImages();
  const [images, setImages] = useState<BlockGatedImage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = imageIds.join(',');

  useEffect(() => {
    let cancelled = false;
    getImages(key.split(',').map(Number))
      .then((rows) => !cancelled && setImages(rows))
      .catch((err: unknown) => {
        console.warn('[generate-studio] gated images:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, getImages]);

  if (failed) return <small role="status">Couldn't load the published images.</small>;
  if (!images) return <small style={{ color: 'var(--civitai-color-text-dimmed)' }}>Loading published images…</small>;

  return (
    <div className="output-grid" data-testid="published">
      {images.map((img) =>
        img.status === 'hidden' ? (
          <div key={img.imageId} style={hiddenCell} data-testid="published-hidden">
            Not available to you
          </div>
        ) : (
          <OutputImage
            key={img.imageId}
            url={img.url}
            // `ratingPending` entries carry NO nsfwLevel: null = "not rated yet".
            nsfwLevel={img.ratingPending ? null : (img.nsfwLevel ?? null)}
            blurMature={blurMature}
            filename={`generate-studio-${img.imageId}.png`}
          />
        ),
      )}
    </div>
  );
}

const hiddenCell = {
  aspectRatio: '1 / 1',
  borderRadius: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--civitai-color-text-dimmed)',
  background: 'var(--civitai-color-media-placeholder)',
} as const;
