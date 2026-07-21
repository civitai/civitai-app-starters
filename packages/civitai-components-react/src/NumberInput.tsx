import { forwardRef } from 'react';

import { describedBy, FieldChrome, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface NumberInputProps
  extends FieldBaseProps,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {}

/**
 * Labeled numeric input. Wraps a native `<input type="number">`. Renders
 * `data-civitai-ui="number-input"`.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { label, description, error, required, className, inputClassName, id, style, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('number-input', id);
  const hasError = error != null && error !== false;
  return (
    <FieldChrome
      uiName="number-input"
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
        type="number"
        {...rest}
        id={ids.inputId}
        className={inputClassName}
        data-civitai-ui-control
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy(description != null, hasError, ids)}
        aria-required={required || undefined}
      />
    </FieldChrome>
  );
});
