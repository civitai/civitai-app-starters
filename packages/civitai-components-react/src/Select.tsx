import { forwardRef } from 'react';

import { describedBy, FieldChrome, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface SelectProps
  extends FieldBaseProps,
    Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {}

/**
 * Labeled native `<select>`. Wraps a native `<select>` (ref-forwarded) reusing
 * the shared `-control` field chrome, exactly like TextInput. Renders the
 * `data-civitai-ui="select"` markup contract with label/description/error wired
 * via `htmlFor`/`aria-describedby`/`aria-invalid`. Pass `<option>`s as children;
 * controlled via `value`/`onChange` (or uncontrolled via `defaultValue`) like
 * any native select.
 *
 * This is the framework-agnostic NATIVE select — NOT the interactive JS Select
 * from `@civitai/blocks-react`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, description, error, required, className, inputClassName, id, style, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('select', id);
  const hasError = error != null && error !== false;
  return (
    <FieldChrome
      uiName="select"
      label={label}
      required={required}
      description={description}
      error={error}
      hasError={hasError}
      className={className}
      ids={ids}
      style={style}
    >
      <select
        ref={ref}
        {...rest}
        id={ids.inputId}
        className={inputClassName}
        data-civitai-ui-control
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy(description != null, hasError, ids)}
        aria-required={required || undefined}
      >
        {children}
      </select>
    </FieldChrome>
  );
});
