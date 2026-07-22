import { forwardRef } from 'react';

import { Loader } from './Loader.js';
import { useComponentStyles } from './styles.js';

export type ButtonVariant = 'filled' | 'light' | 'outline' | 'subtle';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'color'> {
  /** Visual style. Defaults to `'filled'`. */
  variant?: ButtonVariant;
  /** Size preset. Defaults to `'md'`. */
  size?: ButtonSize;
  /** Show a spinner + disable the control (sets `aria-busy`). */
  loading?: boolean;
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  /** Content before the label. */
  leftSection?: React.ReactNode;
  /** Content after the label. */
  rightSection?: React.ReactNode;
}

/**
 * Themed button — wraps a native `<button>` (ref-forwarded). Renders the
 * `data-civitai-ui="button"` + `data-variant`/`data-size` contract that
 * `@civitai/components` styles. Mirrors `@civitai/blocks-react`'s `Button`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'filled',
    size = 'md',
    loading = false,
    fullWidth = false,
    leftSection,
    rightSection,
    disabled,
    onClick,
    children,
    type,
    ...rest
  },
  ref
): React.JSX.Element {
  useComponentStyles();
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      {...rest}
      data-civitai-ui="button"
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth ? 'true' : undefined}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onClick={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
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
