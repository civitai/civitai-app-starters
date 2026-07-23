import { forwardRef } from 'react';

import { ChoiceChrome, describedBy, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface CheckboxProps
  extends FieldBaseProps,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {}

/**
 * Themed checkbox. Wraps a native `<input type="checkbox">` (ref-forwarded) so
 * keyboard/indeterminate/tab behavior is native; `accent-color` carries the
 * theme tint. Renders the `data-civitai-ui="checkbox"` contract: the box + its
 * inline label in a `-choice` row, description/error below, wired via
 * `htmlFor`/`aria-describedby`/`aria-invalid`. Controlled via `checked`/
 * `onChange` (or uncontrolled via `defaultChecked`) like any native checkbox.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, error, required, className, inputClassName, id, style, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('checkbox', id);
  const hasError = error != null && error !== false;
  return (
    <ChoiceChrome
      uiName="checkbox"
      label={label}
      required={required}
      description={description}
      error={error}
      hasError={hasError}
      className={className}
      ids={ids}
      style={style}
    >
      <input
        ref={ref}
        type="checkbox"
        {...rest}
        id={ids.inputId}
        className={inputClassName}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy(description != null, hasError, ids)}
        aria-required={required || undefined}
      />
    </ChoiceChrome>
  );
});
