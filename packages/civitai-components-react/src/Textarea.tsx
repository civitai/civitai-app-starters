import { forwardRef } from 'react';

import { describedBy, FieldChrome, useFieldIds, type FieldBaseProps } from './internal/field.js';
import { useComponentStyles } from './styles.js';

export interface TextareaProps
  extends FieldBaseProps,
    React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/** Labeled multi-line input. Renders `data-civitai-ui="textarea"`. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, required, className, inputClassName, id, style, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  const ids = useFieldIds('textarea', id);
  const hasError = error != null && error !== false;
  return (
    <FieldChrome
      uiName="textarea"
      label={label}
      required={required}
      description={description}
      error={error}
      hasError={hasError}
      className={className}
      ids={ids}
      style={style}
    >
      <textarea
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
