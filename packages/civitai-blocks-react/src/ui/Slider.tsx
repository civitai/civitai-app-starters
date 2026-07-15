import { forwardRef, useId } from 'react';

import { useBlocksStyles } from './styles.js';

export interface SliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'onChange' | 'value' | 'defaultValue' | 'type' | 'size' | 'min' | 'max' | 'step'
  > {
  /** Current value (controlled). */
  value: number;
  /** Fires with the new numeric value on every input (drag / keyboard). */
  onChange: (value: number) => void;
  /** Minimum value. Default `0`. */
  min?: number;
  /** Maximum value. Default `100`. */
  max?: number;
  /** Step increment. Default `1`. */
  step?: number;
  /** Visible field label, rendered in a `<label>` linked to the input. */
  label?: React.ReactNode;
  /** Helper text under the label, linked via `aria-describedby`. */
  description?: React.ReactNode;
  /** Error message. Sets `aria-invalid`, announces (`role="alert"`), links it. */
  error?: React.ReactNode;
  /** Mark required: shows an asterisk and sets the native `required`. */
  required?: boolean;
  /** Show the current value at the end of the label row. Default `false`. */
  showValue?: boolean;
  /** Class on the wrapping element. */
  className?: string;
  /** Class applied to the native range `<input>`. */
  inputClassName?: string;
}

/**
 * Labeled range slider — the primitive the Custom Generators app most needed
 * (LoRA weights). Wraps a native `input[type="range"]` (ref-forwarded), so it
 * is keyboard-operable (arrows / Home / End / PageUp / PageDown) and exposes an
 * implicit `role="slider"` with `aria-valuemin`/`max`/`now` for free. The label,
 * description and error are wired via `htmlFor` / `id` / `aria-describedby` /
 * `aria-invalid`. Auto-themed via `useBlocksStyles()`; the accent tracks
 * `--ci-color-primary`.
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    label,
    description,
    error,
    required,
    showValue = false,
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
  const inputId = id ?? `ci-slider-${reactId}`;
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
      data-civitai-ui="slider"
      data-invalid={hasError ? 'true' : undefined}
      style={style}
    >
      {label != null || showValue ? (
        <label htmlFor={inputId} data-civitai-ui-label>
          <span>
            {label}
            {required ? (
              <span data-civitai-ui-required aria-hidden="true">
                *
              </span>
            ) : null}
          </span>
          {showValue ? (
            <span data-civitai-ui-slider-value>{value}</span>
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
        type="range"
        className={inputClassName}
        data-civitai-ui-range
        min={min}
        max={max}
        step={step}
        value={value}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hasError ? (
        <span id={errId} data-civitai-ui-error role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
