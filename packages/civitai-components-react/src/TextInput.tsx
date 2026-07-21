import { forwardRef } from 'react';

import { describedBy, FieldChrome, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface TextInputProps
  extends FieldBaseProps,
    Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {}

/**
 * Labeled text input. Wraps a native `<input>` (ref-forwarded). Renders the
 * `data-civitai-ui="text-input"` markup contract with label/description/error
 * wired via `htmlFor`/`aria-describedby`/`aria-invalid`.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, description, error, required, className, inputClassName, id, style, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('text-input', id);
  const hasError = error != null && error !== false;
  return (
    <FieldChrome
      uiName="text-input"
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
