import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type BadgeVariant = 'filled' | 'light' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';
/** Intent color, mirroring Alert's `data-color` contract. */
export type BadgeColor = 'info' | 'success' | 'warning' | 'error';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Visual style. Defaults to `'filled'`. */
  variant?: BadgeVariant;
  /** Size preset. Defaults to `'md'`. */
  size?: BadgeSize;
  /**
   * Intent color (maps to `data-color`), mirroring Alert. When omitted, the
   * badge uses the default primary accent (unchanged / non-breaking).
   */
  color?: BadgeColor;
}

/** Small status pill. Renders `data-civitai-ui="badge"`. */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'filled', size = 'md', color, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <span
      ref={ref}
      {...rest}
      data-civitai-ui="badge"
      data-variant={variant}
      data-size={size}
      data-color={color}
    >
      {children}
    </span>
  );
});
