import { forwardRef, useState } from 'react';

import { describedBy, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'>,
    FieldBaseProps {
  /**
   * Render a live current-value read-out next to the label. Either a static
   * node, or a formatter called with the current numeric value (works for
   * controlled AND uncontrolled sliders — the binding mirrors the value
   * internally to drive the read-out).
   */
  valueLabel?: React.ReactNode | ((value: number) => React.ReactNode);
}

/**
 * Themed range slider — wraps a native `<input type="range">` (ref-forwarded).
 * Renders the `data-civitai-ui="slider"` contract: label (+ optional value
 * read-out), description, the range control (styled via `accent-color`, so
 * arrow-key/Home/End keyboard nav + ARIA come from the native control), and an
 * error. The range input does NOT carry `data-civitai-ui-control` (that is the
 * bordered field-input chrome).
 */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    label,
    description,
    error,
    required,
    className,
    inputClassName,
    valueLabel,
    id,
    value,
    defaultValue,
    min = 0,
    max = 100,
    onChange,
    ...rest
  },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('slider', id);
  const hasError = error != null && error !== false;
  const isControlled = value != null;

  const seed = Number(value ?? defaultValue ?? (Number(min) + Number(max)) / 2);
  const [internal, setInternal] = useState<number>(Number.isNaN(seed) ? 0 : seed);
  const current = isControlled ? Number(value) : internal;

  const showValue = valueLabel != null;
  const valueNode =
    typeof valueLabel === 'function'
      ? (valueLabel as (v: number) => React.ReactNode)(current)
      : valueLabel;
  // Expose the human-readable value to screen readers when it differs from the
  // raw number (e.g. "20%", "Large") — `aria-valuenow` alone would be wrong.
  // Only a string/number-yielding label maps to a valid `aria-valuetext`.
  const valueText =
    typeof valueNode === 'string' || typeof valueNode === 'number'
      ? String(valueNode)
      : undefined;

  return (
    <div
      className={className}
      data-civitai-ui="slider"
      data-invalid={hasError ? 'true' : undefined}
    >
      {label != null ? (
        showValue ? (
          <div data-civitai-ui-slider-header>
            <label htmlFor={ids.inputId} data-civitai-ui-label>
              {label}
              {required ? (
                <span data-civitai-ui-required aria-hidden="true">
                  *
                </span>
              ) : null}
            </label>
            <output htmlFor={ids.inputId} data-civitai-ui-slider-value>
              {valueNode}
            </output>
          </div>
        ) : (
          <label htmlFor={ids.inputId} data-civitai-ui-label>
            {label}
            {required ? (
              <span data-civitai-ui-required aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        )
      ) : null}
      {description != null ? (
        <span id={ids.descId} data-civitai-ui-description>
          {description}
        </span>
      ) : null}
      <input
        ref={ref}
        {...rest}
        type="range"
        id={ids.inputId}
        className={inputClassName}
        min={min}
        max={max}
        value={value}
        defaultValue={defaultValue}
        aria-describedby={describedBy(description != null, hasError, ids)}
        aria-invalid={hasError || undefined}
        aria-valuetext={valueText}
        onChange={(e) => {
          if (!isControlled) setInternal(Number(e.currentTarget.value));
          onChange?.(e);
        }}
      />
      {hasError ? (
        <span id={ids.errId} data-civitai-ui-error role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
