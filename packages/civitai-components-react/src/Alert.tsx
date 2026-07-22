import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type AlertColor = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Intent color. Defaults to `'info'`. */
  color?: AlertColor;
  /** Optional bold title above the body. */
  title?: React.ReactNode;
  /** Optional leading icon. */
  icon?: React.ReactNode;
  /** When provided, renders a dismiss button that calls this handler. */
  onClose?: () => void;
  /** Accessible label for the dismiss button. Defaults to `'Dismiss'`. */
  closeLabel?: string;
}

/**
 * Status alert. Renders `data-civitai-ui="alert"` with `role="alert"` (override
 * via `role` for non-urgent `status`).
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { color = 'info', title, icon, onClose, closeLabel = 'Dismiss', children, role, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div ref={ref} {...rest} data-civitai-ui="alert" data-color={color} role={role ?? 'alert'}>
      {icon != null ? <span aria-hidden="true">{icon}</span> : null}
      <div data-civitai-ui-alert-body>
        {title != null ? <div data-civitai-ui-alert-title>{title}</div> : null}
        {children}
      </div>
      {onClose != null ? (
        <button
          type="button"
          data-civitai-ui-alert-close
          aria-label={closeLabel}
          onClick={onClose}
        >
          {'×'}
        </button>
      ) : null}
    </div>
  );
});
