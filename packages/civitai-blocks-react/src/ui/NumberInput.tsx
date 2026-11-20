import { forwardRef, useId } from 'react';

import { useBlocksStyles } from './styles.js';

export interface NumberInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'defaultValue' | 'type' | 'size' | 'min' | 'max' | 'step'
  > {
  /** Current value (controlled). `null` renders an empty field. */
  value: number | null;
  /** Fires with the parsed number, or `null` when the field is cleared. */
  onChange: (value: number | null) => void;
  /** Lower bound. Enforced (clamped) on blur. */
  min?: number;
  /** Upper bound. Enforced (clamped) on blur. */
  max?: number;
  /** Step increment for the native spinner. Default `1`. */
  step?: number;
  /** Visible field label, rendered in a `<label>` linked to the input. */
  label?: React.ReactNode;
  /** Helper text under the label, linked via `aria-describedby`. */
  description?: React.ReactNode;
  /** Error message. Sets `aria-invalid`, announces (`role="alert"`), links it. */
  error?: React.ReactNode;
  /** Mark required: shows an asterisk and sets the native `required`. */
  required?: boolean;
  /** Class on the wrapping element. */
  className?: string;
  /** Class applied to the native `<input>`. */
  inputClassName?: string;
}

function clamp(n: number, min?: number, max?: number): number {
  let out = n;
  if (min !== undefined && out < min) out = min;
  if (max !== undefined && out > max) out = max;
  return out;
}

/**
 * Labeled numeric input (steps / cfg / quantity params). Wraps a native
 * `input[type="number"]` (ref-forwarded).
 *
 * - Fully controlled by `value` (`number | null`; `null` === empty).
 * - **Rejects non-numeric** input: a keystroke that does not parse to a finite
 *   number is ignored (no `onChange`), so the model value never goes NaN.
 * - **Clamps to `[min, max]` on blur** — free typing is allowed while focused
 *   (so "12" survives a `min` of 10 mid-type), then the committed value is
 *   corrected to the nearest bound.
 *
 * Same label/description/error a11y wiring as `<TextInput>`. Auto-themed.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      onChange,
      min,
      max,
      step = 1,
      label,
      description,
      error,
      required,
      className,
      inputClassName,
      id,
      style,
      onBlur,
      ...rest
    },
    ref
  ): React.JSX.Element {
    useBlocksStyles();
    const reactId = useId();
    const inputId = id ?? `ci-number-${reactId}`;
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
        data-civitai-ui="number-input"
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
          {...rest}
          id={inputId}
          type="number"
          inputMode="decimal"
          className={inputClassName}
          data-civitai-ui-control
          min={min}
          max={max}
          step={step}
          required={required}
          value={value ?? ''}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={required || undefined}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') {
              onChange(null);
              return;
            }
            const parsed = Number(raw);
            // Reject non-numeric — leave the model value untouched.
            if (!Number.isFinite(parsed)) return;
            onChange(parsed);
          }}
          onBlur={(e) => {
            if (value !== null) {
              const clamped = clamp(value, min, max);
              if (clamped !== value) onChange(clamped);
            }
            onBlur?.(e);
          }}
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
