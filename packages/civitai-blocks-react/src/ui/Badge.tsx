import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type BadgeVariant = 'filled' | 'light' | 'outline';
export type BadgeSize = 'sm' | 'md' | 'lg';

export interface BadgeProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'color'> {
  /** Visual style. Defaults to `'light'`. */
  variant?: BadgeVariant;
  /** Size preset. Defaults to `'md'`. */
  size?: BadgeSize;
  /**
   * Accent color. `'primary'` (default), a semantic token name
   * (`'error' | 'success' | 'warning' | 'info'`), or any CSS color string.
   */
  color?: 'primary' | 'error' | 'success' | 'warning' | 'info' | (string & {});
}

const SEMANTIC_COLORS = new Set(['error', 'success', 'warning', 'info']);

function resolveAccent(color: BadgeProps['color']): string | undefined {
  if (!color || color === 'primary') return undefined;
  if (SEMANTIC_COLORS.has(color)) return `var(--ci-color-${color})`;
  return color;
}

/**
 * A small status/label pill. Wraps a `<span>` (ref-forwarded). Auto-themed.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'light', size = 'md', color = 'primary', style, children, ...rest },
  ref
): React.JSX.Element {
  useBlocksStyles();
  const accent = resolveAccent(color);
  return (
    <span
      ref={ref}
      data-civitai-ui="badge"
      data-variant={variant}
      data-size={size}
      style={
        accent
          ? ({
              ['--ci-color-primary' as string]: accent,
              ...style,
            } as React.CSSProperties)
          : style
      }
      {...rest}
    >
      {children}
    </span>
  );
});
