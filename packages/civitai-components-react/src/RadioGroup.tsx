import { forwardRef, useId } from 'react';

import { useComponentStyles } from './styles.js';

export type RadioGroupOrientation = 'vertical' | 'horizontal';

export interface RadioGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Group label (rendered above the options, linked via `aria-labelledby`). */
  label?: React.ReactNode;
  /** Helper text under the label (linked via `aria-describedby`). */
  description?: React.ReactNode;
  /** Option layout. Defaults to `'vertical'`. */
  orientation?: RadioGroupOrientation;
}

/**
 * Layout + semantics container for a set of `Radio`s. Renders
 * `data-civitai-ui="radio-group"` with `role="radiogroup"`, an optional group
 * label (wired via `aria-labelledby`) and description (via `aria-describedby`),
 * and the radios laid out vertically (default) or horizontally. Presentational:
 * give the child `Radio`s a shared `name` to make them a native radio set.
 */
export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(function RadioGroup(
  { label, description, orientation = 'vertical', children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const reactId = useId();
  const labelId = `ci-radio-group-${reactId}-label`;
  const descId = `ci-radio-group-${reactId}-desc`;
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="radio-group"
      role="radiogroup"
      aria-labelledby={label != null ? labelId : undefined}
      aria-describedby={description != null ? descId : undefined}
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
    </div>
  );
});
