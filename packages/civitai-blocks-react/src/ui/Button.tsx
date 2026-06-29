import { forwardRef } from 'react';

import { Loader } from './Loader.js';
import { useBlocksStyles } from './styles.js';

export type ButtonVariant = 'filled' | 'light' | 'outline' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  /** Visual style. Defaults to `'filled'`. */
  variant?: ButtonVariant;
  /** Size preset. Defaults to `'md'`. */
  size?: ButtonSize;
  /**
   * Accent color. `'primary'` (default) or a semantic token name
   * (`'error' | 'success' | 'warning' | 'info'`), or any CSS color string —
   * it overrides the `--ci-color-primary` the variant styling reads.
   */
  color?: 'primary' | 'error' | 'success' | 'warning' | 'info' | (string & {});
  /**
   * Show a spinner and disable the button. Sets `aria-busy` and blocks clicks
   * (both via the native `disabled` and a guard, so a controlled `onClick`
   * never fires while loading).
   */
  loading?: boolean;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  /** Content rendered before the label (icon, etc.). */
  leftSection?: React.ReactNode;
  /** Content rendered after the label. */
  rightSection?: React.ReactNode;
}

const SEMANTIC_COLORS = new Set(['error', 'success', 'warning', 'info']);

function resolveAccent(color: ButtonProps['color']): string | undefined {
  if (!color || color === 'primary') return undefined;
  if (SEMANTIC_COLORS.has(color)) return `var(--ci-color-${color})`;
  return color;
}

/**
 * Themed button. Wraps a native `<button>` (ref-forwarded, all native props
 * pass through). `loading` shows a `<Loader>` and disables the control.
 *
 * Styling is automatic via `useBlocksStyles()`; the `data-variant` / `data-size`
 * / `data-full-width` attributes drive the injected CSS.
 *
 * @example
 * <Button loading={status === 'submitting'} fullWidth onClick={onGenerate}>
 *   Generate
 * </Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'filled',
    size = 'md',
    color = 'primary',
    loading = false,
    fullWidth = false,
    leftSection,
    rightSection,
    disabled,
    onClick,
    children,
    style,
    type,
    ...rest
  },
  ref
): React.JSX.Element {
  useBlocksStyles();
  const accent = resolveAccent(color);
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      // Default to type="button" — a block author dropping a <Button> into a
      // <form> almost never wants an implicit submit. They can opt into
      // type="submit" explicitly.
      type={type ?? 'button'}
      // Spread author props FIRST so the component-owned attributes below win —
      // an author must not be able to clobber data-civitai-ui (the stylesheet
      // selector) or aria-busy (the loading state) via a stray spread prop.
      {...rest}
      data-civitai-ui="button"
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth ? 'true' : undefined}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(e) => {
        // Belt-and-suspenders: a `disabled` <button> won't fire onClick, but
        // guard anyway so `loading` reliably blocks the handler.
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      style={
        accent
          ? ({
              ['--ci-color-primary' as string]: accent,
              ['--ci-color-primary-hover' as string]: accent,
              ...style,
            } as React.CSSProperties)
          : style
      }
    >
      {loading ? <Loader size="sm" aria-hidden="true" /> : null}
      {leftSection != null ? (
        <span data-civitai-ui-section="left">{leftSection}</span>
      ) : null}
      {children}
      {rightSection != null ? (
        <span data-civitai-ui-section="right">{rightSection}</span>
      ) : null}
    </button>
  );
});
