import { forwardRef, useId } from 'react';

import { useBlocksStyles } from './styles.js';

/** One option for the declarative `options` prop. */
export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    'onChange' | 'value' | 'defaultValue' | 'size'
  > {
  /** Current value (controlled). */
  value: string;
  /** Fires with the selected option's value. */
  onChange: (value: string) => void;
  /** Declarative options. Alternative to `<option>` `children`. */
  options?: SelectOption[];
  /** `<option>` children — use instead of `options` for full control. */
  children?: React.ReactNode;
  /**
   * Placeholder shown as a disabled, empty-valued leading option. Rendered
   * only alongside `options`.
   */
  placeholder?: string;
  /** Visible field label, rendered in a `<label>` linked to the select. */
  label?: React.ReactNode;
  /** Helper text under the label, linked via `aria-describedby`. */
  description?: React.ReactNode;
  /** Error message. Sets `aria-invalid`, announces (`role="alert"`), links it. */
  error?: React.ReactNode;
  /** Mark required: shows an asterisk and sets the native `required`. */
  required?: boolean;
  /** Class on the wrapping element. */
  className?: string;
  /** Class applied to the native `<select>`. */
  selectClassName?: string;
}

/**
 * Labeled dropdown (sampler / base-model / workflow-type). Wraps a native
 * `<select>` (ref-forwarded) — keyboard-operable and announced as a combobox
 * with its `<label>` for free. Supply choices via `options` or `<option>`
 * `children`. Same label/description/error a11y wiring as `<TextInput>`.
 * Auto-themed.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    value,
    onChange,
    options,
    children,
    placeholder,
    label,
    description,
    error,
    required,
    className,
    selectClassName,
    id,
    style,
    ...rest
  },
  ref
): React.JSX.Element {
  useBlocksStyles();
  const reactId = useId();
  const selectId = id ?? `ci-select-${reactId}`;
  const descId = `${selectId}-desc`;
  const errId = `${selectId}-err`;
  const hasError = error != null && error !== false;
  const describedBy =
    [description != null ? descId : null, hasError ? errId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      className={className}
      data-civitai-ui="select"
      data-invalid={hasError ? 'true' : undefined}
      style={style}
    >
      {label != null ? (
        <label htmlFor={selectId} data-civitai-ui-label>
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
      <select
        ref={ref}
        {...rest}
        id={selectId}
        className={selectClassName}
        data-civitai-ui-control
        required={required}
        value={value}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        {options ? (
          <>
            {placeholder !== undefined ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </>
        ) : (
          children
        )}
      </select>
      {hasError ? (
        <span id={errId} data-civitai-ui-error role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
