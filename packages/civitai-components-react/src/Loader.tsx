import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type LoaderSize = 'sm' | 'md' | 'lg';

export interface LoaderProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Size preset. Defaults to `'md'`. */
  size?: LoaderSize;
}

/**
 * Spinner. Renders `data-civitai-ui="loader"`. Decorative by default — pass
 * `aria-hidden` when inside a button, or wrap with `role="status"` + a label
 * when standalone.
 */
export const Loader = forwardRef<HTMLSpanElement, LoaderProps>(function Loader(
  { size = 'md', ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return <span ref={ref} {...rest} data-civitai-ui="loader" data-size={size} />;
});
