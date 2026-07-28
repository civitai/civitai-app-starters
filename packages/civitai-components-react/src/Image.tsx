import { forwardRef, useEffect, useRef, useState } from 'react';

import { useComponentStyles } from './styles.js';

export type ImageFit = 'cover' | 'contain';
export type ImageStatus = 'loading' | 'loaded' | 'error';

export interface ImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onError' | 'onLoad'> {
  /** Fallback content shown (overlaid) when the image fails to load. */
  fallback?: React.ReactNode;
  /** `object-fit` of the image. Defaults to `'cover'`. */
  fit?: ImageFit;
  /** Class on the wrapper element (size it here). */
  wrapperClassName?: string;
  /** Style on the wrapper element (e.g. `aspectRatio` / width / height). */
  wrapperStyle?: React.CSSProperties;
  /** Notified on load / error transitions. */
  onStatusChange?: (status: ImageStatus) => void;
}

/**
 * Media primitive with loading + broken-image handling. Renders the
 * `data-civitai-ui="image"` container (token placeholder background while
 * loading), an `<img data-civitai-ui-image-img>` (ref-forwarded, `object-fit`
 * via `data-fit`), and an optional fallback overlay shown on error. Tracks
 * `data-status` off the native `load`/`error` events (and handles
 * already-cached images that fire no event).
 */
export const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  { fallback, fit = 'cover', wrapperClassName, wrapperStyle, onStatusChange, src, alt = '', ...rest },
  forwardedRef
): React.JSX.Element {
  useComponentStyles();
  const [status, setStatus] = useState<ImageStatus>('loading');
  const localRef = useRef<HTMLImageElement | null>(null);

  const update = (next: ImageStatus) => {
    setStatus(next);
    onStatusChange?.(next);
  };

  // Reset to loading whenever the source changes.
  useEffect(() => {
    setStatus('loading');
  }, [src]);

  // A cached image can be `complete` before React attaches load/error handlers,
  // so no event fires — reconcile from the element state on mount/src change.
  useEffect(() => {
    const img = localRef.current;
    if (!img) return;
    if (img.complete && img.currentSrc) {
      update(img.naturalWidth > 0 ? 'loaded' : 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div
      className={wrapperClassName}
      style={wrapperStyle}
      data-civitai-ui="image"
      data-status={status}
    >
      <img
        ref={(el) => {
          localRef.current = el;
          if (typeof forwardedRef === 'function') forwardedRef(el);
          else if (forwardedRef) forwardedRef.current = el;
        }}
        {...rest}
        src={src}
        alt={alt}
        data-civitai-ui-image-img=""
        data-fit={fit}
        onLoad={() => update('loaded')}
        onError={() => update('error')}
      />
      {fallback != null ? (
        <div data-civitai-ui-image-fallback="" aria-hidden={status !== 'error'}>
          {fallback}
        </div>
      ) : null}
    </div>
  );
});
