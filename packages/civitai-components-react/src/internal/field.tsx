import { useId } from 'react';

/** Shared label/description/error props for the labeled input components. */
export interface FieldBaseProps {
  /** Visible field label. */
  label?: React.ReactNode;
  /** Helper text under the label (linked via `aria-describedby`). */
  description?: React.ReactNode;
  /** Error message. Sets `aria-invalid` + announces via `role="alert"`. */
  error?: React.ReactNode;
  /** Mark required (asterisk + native `required`). */
  required?: boolean;
  /** Class on the wrapping element. */
  className?: string;
  /** Class applied to the control element. */
  inputClassName?: string;
}

export interface FieldIds {
  inputId: string;
  descId: string;
  errId: string;
}

export function useFieldIds(prefix: string, id?: string): FieldIds {
  const reactId = useId();
  const inputId = id ?? `ci-${prefix}-${reactId}`;
  return { inputId, descId: `${inputId}-desc`, errId: `${inputId}-err` };
}

/** `aria-describedby` value for the control, or undefined. */
export function describedBy(hasDescription: boolean, hasError: boolean, ids: FieldIds): string | undefined {
  return (
    [hasDescription ? ids.descId : null, hasError ? ids.errId : null].filter(Boolean).join(' ') ||
    undefined
  );
}

/**
 * Renders the shared field chrome: wrapper `<div data-civitai-ui="{uiName}">`,
 * label (+ required asterisk), description, the control (`children`), and error.
 * The control passed as `children` must already carry `data-civitai-ui-control`
 * + the wired aria attributes.
 */
export function FieldChrome({
  uiName,
  label,
  required,
  description,
  error,
  hasError,
  className,
  ids,
  style,
  children,
}: {
  uiName: string;
  hasError: boolean;
  ids: FieldIds;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & Pick<FieldBaseProps, 'label' | 'required' | 'description' | 'error' | 'className'>): React.JSX.Element {
  return (
    <div
      className={className}
      data-civitai-ui={uiName}
      data-invalid={hasError ? 'true' : undefined}
      style={style}
    >
      {label != null ? (
        <label htmlFor={ids.inputId} data-civitai-ui-label>
          {label}
          {required ? (
            <span data-civitai-ui-required aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {description != null ? (
        <span id={ids.descId} data-civitai-ui-description>
          {description}
        </span>
      ) : null}
      {children}
      {hasError ? (
        <span id={ids.errId} data-civitai-ui-error role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
