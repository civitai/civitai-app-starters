import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type LoaderSize = 'sm' | 'md' | 'lg';

export interface LoaderProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** Spinner diameter. Defaults to `'md'`. */
  size?: LoaderSize;
  /**
   * Spinner color. Any CSS color; defaults to the primary token. Inside a
   * `<Button loading>` the loader inherits the button's text color instead.
   */
  color?: string;
}

/**
 * A CSS-keyframe spinner. Headless, auto-themed. Reused by `<Button loading>`.
 *
 * Carries `role="status"` + an accessible label so screen readers announce a
 * busy state; pass `aria-label` to override the default "Loading".
 */
export const Loader = forwardRef<HTMLSpanElement, LoaderProps>(function Loader(
  { size = 'md', color, style, ...rest },
  ref
): React.JSX.Element {
  useBlocksStyles();
  return (
    <span
      ref={ref}
      data-civitai-ui="loader"
      data-size={size}
      role="status"
      aria-label={rest['aria-label'] ?? 'Loading'}
      style={color ? { color, ...style } : style}
      {...rest}
    />
  );
});
