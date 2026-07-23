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

/**
 * Design-system reconciliation (0.35.0):
 *
 * `@civitai/components` 0.1.2 added a `data-color` intent contract to its Badge
 * (info / success / warning / error), mirroring Alert. We deliberately DO NOT
 * emit `data-color` here and keep the pre-existing inline-CSS-var override
 * instead (now `--civitai-color-primary`, renamed from `--ci-color-primary`).
 * Rationale: this Badge's public `color` prop also accepts ANY CSS color string
 * (e.g. `#ff00ff`, `hsl(...)`), which `data-color` cannot express — it only
 * covers the 4 named intents. Overriding `--civitai-color-primary` inline keeps
 * the FULL public API working unchanged (the component's variant rules read that
 * token), so this is the least-breaking choice. Named intents resolve to the
 * design-system's `--civitai-color-<intent>` token, so they still track the
 * theme correctly.
 */
function resolveAccent(color: BadgeProps['color']): string | undefined {
  if (!color || color === 'primary') return undefined;
  if (SEMANTIC_COLORS.has(color)) return `var(--civitai-color-${color})`;
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
      {...rest}
      data-civitai-ui="badge"
      data-variant={variant}
      data-size={size}
      style={
        accent
          ? ({
              ['--civitai-color-primary' as string]: accent,
              ...style,
            } as React.CSSProperties)
          : style
      }
    >
      {children}
    </span>
  );
});
