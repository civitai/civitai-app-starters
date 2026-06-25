import { forwardRef, useId } from 'react';

import { useBlocksStyles } from './styles.js';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible field label, rendered in a `<label>` linked to the textarea. */
  label?: React.ReactNode;
  /** Helper text under the label, linked via `aria-describedby`. */
  description?: React.ReactNode;
  /**
   * Error message. When set, the control gets `aria-invalid="true"`, the
   * message is announced (`role="alert"`) and linked via `aria-describedby`.
   */
  error?: React.ReactNode;
  /** Mark required: shows an asterisk and sets the native `required`. */
  required?: boolean;
  /**
   * Initial visible rows. Alias of the native `rows`; `minRows` wins if both
   * are passed (kept for parity with Mantine's `minRows`). This is a static
   * minimum — v0 does not auto-grow the textarea.
   */
  minRows?: number;
  /** Class on the wrapping element. */
  className?: string;
  /** Class applied to the native `<textarea>`. */
  textareaClassName?: string;
}

/**
 * Labeled multi-line text input. Wraps a native `<textarea>` (ref-forwarded),
 * same label/description/error wiring as `<TextInput>`. Auto-themed.
 *
 * `minRows` is a static minimum-rows hint (maps to the native `rows`); v0 does
 * not auto-grow — note this limitation in the README.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      description,
      error,
      required,
      minRows,
      rows,
      className,
      textareaClassName,
      id,
      style,
      ...rest
    },
    ref
  ): React.JSX.Element {
    useBlocksStyles();
    const reactId = useId();
    const inputId = id ?? `ci-textarea-${reactId}`;
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
        data-civitai-ui="textarea"
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
        <textarea
          ref={ref}
          {...rest}
          id={inputId}
          className={textareaClassName}
          data-civitai-ui-control
          rows={minRows ?? rows ?? 3}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
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
