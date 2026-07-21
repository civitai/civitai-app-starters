import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type BadgeVariant = 'filled' | 'light' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual style. Defaults to `'filled'`. */
  variant?: BadgeVariant;
  /** Size preset. Defaults to `'md'`. */
  size?: BadgeSize;
}

/** Small status pill. Renders `data-civitai-ui="badge"`. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'filled', size = 'md', children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <span ref={ref} {...rest} data-civitai-ui="badge" data-variant={variant} data-size={size}>
      {children}
    </span>
  );
});
