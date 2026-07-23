import { forwardRef } from 'react';

import { ChoiceChrome, describedBy, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface RadioProps
  extends FieldBaseProps,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {}

/**
 * Themed radio button. Wraps a native `<input type="radio">` (ref-forwarded);
 * `accent-color` carries the theme tint. Renders the `data-civitai-ui="radio"`
 * contract — box + inline label in a `-choice` row, description/error below.
 * Group several by giving them the same `name` (see RadioGroup for the
 * `role=radiogroup` layout). Controlled via `checked`/`onChange`.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, description, error, required, className, inputClassName, id, style, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('radio', id);
  const hasError = error != null && error !== false;
  return (
    <ChoiceChrome
      uiName="radio"
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
        type="radio"
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
