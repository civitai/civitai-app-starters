import { forwardRef, useId } from 'react';

import { useBlocksStyles } from './styles.js';

export interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible field label, rendered in a `<label>` linked to the input. */
  label?: React.ReactNode;
  /** Helper text under the label, linked via `aria-describedby`. */
  description?: React.ReactNode;
  /**
   * Error message. When set, the input gets `aria-invalid="true"`, the message
   * is announced (`role="alert"`) and linked via `aria-describedby`.
   */
  error?: React.ReactNode;
  /** Mark required: shows an asterisk and sets the native `required`. */
  required?: boolean;
  /** Class on the wrapping element (the `<input>` is `inputClassName`). */
  className?: string;
  /** Class applied to the native `<input>`. */
  inputClassName?: string;
}

/**
 * Labeled text input. Wraps a native `<input>` (ref-forwarded). The label,
 * description and error are wired to the control via `htmlFor` / `id` /
 * `aria-describedby` / `aria-invalid` so the field is announced correctly.
 *
 * Auto-themed via `useBlocksStyles()`.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    {
      label,
      description,
      error,
      required,
      className,
      inputClassName,
      id,
      style,
      ...rest
    },
    ref
  ): React.JSX.Element {
    useBlocksStyles();
    const reactId = useId();
    const inputId = id ?? `ci-input-${reactId}`;
    const descId = `${inputId}-desc`;
    const errId = `${inputId}-err`;
    const hasError = error != null && error !== false;
    const describedBy =
      [description != null ? descId : null, hasError ? errId : null]
        .filter(Boolean)
        .join(' ') || undefined;

    return (
      <div
        className={className}
        data-civitai-ui="text-input"
        data-invalid={hasError ? 'true' : undefined}
        style={style}
      >
        {label != null ? (
          <label htmlFor={inputId} data-civitai-ui-label>
            {label}
            {required ? (
              <span data-civitai-ui-required aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        ) : null}
        {description != null ? (
          <span id={descId} data-civitai-ui-description>
            {description}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={inputClassName}
          data-civitai-ui-control
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          {...rest}
        />
        {hasError ? (
          <span id={errId} data-civitai-ui-error role="alert">
            {error}
          </span>
        ) : null}
      </div>
    );
  }
);
