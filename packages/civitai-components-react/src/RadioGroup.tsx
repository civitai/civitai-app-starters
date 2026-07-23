import { forwardRef, useId } from 'react';

import { describedBy } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Group label (rendered above the options, linked via `aria-labelledby`). */
  label?: React.ReactNode;
  /** Helper text under the label (linked via `aria-describedby`). */
  description?: React.ReactNode;
  /**
   * Group-level validation message. When set, renders a
   * `data-civitai-ui-error` element with `role="alert"`, sets `aria-invalid` +
   * `data-invalid` on the group, and joins the error id into the group's
   * `aria-describedby` (mirrors the field components' `error` contract).
   */
  error?: React.ReactNode;
  /** Option layout. Defaults to `'vertical'`. */
  orientation?: RadioGroupOrientation;
}

/**
 * Layout + semantics container for a set of `Radio`s. Renders
 * `data-civitai-ui="radio-group"` with `role="radiogroup"`, an optional group
 * label (wired via `aria-labelledby`), description (via `aria-describedby`) and
 * a group-level error (via `role="alert"` + `aria-invalid`/`data-invalid`, the
 * error id joined into `aria-describedby`), and the radios laid out vertically
 * (default) or horizontally. Presentational: give the child `Radio`s a shared
 * `name` to make them a native radio set.
 */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { label, description, error, orientation = 'vertical', children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const reactId = useId();
  const labelId = `ci-radio-group-${reactId}-label`;
  const descId = `ci-radio-group-${reactId}-desc`;
  const errId = `ci-radio-group-${reactId}-err`;
  const hasError = error != null && error !== false;
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="radio-group"
      data-invalid={hasError ? 'true' : undefined}
      role="radiogroup"
      aria-labelledby={label != null ? labelId : undefined}
      aria-describedby={describedBy(description != null, hasError, { inputId: labelId, descId, errId })}
      aria-invalid={hasError || undefined}
    >
      {label != null ? (
        <span id={labelId} data-civitai-ui-label>
          {label}
        </span>
      ) : null}
      {description != null ? (
        <span id={descId} data-civitai-ui-description>
          {description}
        </span>
      ) : null}
      <div data-civitai-ui-radio-options data-orientation={orientation}>
        {children}
      </div>
      {hasError ? (
        <span id={errId} data-civitai-ui-error role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
});
