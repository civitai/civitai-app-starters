import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type ToastColor = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Intent accent (left border). Omit for the neutral accent. */
  color?: ToastColor;
  /** Optional bold title above the message. */
  title?: React.ReactNode;
  /** When set, renders a dismiss button that calls this. */
  onClose?: () => void;
  /**
   * Urgent toasts use `role="alert"` (assertive) instead of the default
   * `role="status"` (polite).
   */
  urgent?: boolean;
}

/**
 * Presentational toast card — the visual half of the notification system,
 * decoupled from `ToastProvider`/`useToast` (which own the queue + timers) so
 * hand-HTML and React share one `data-civitai-ui="toast"` contract. Renders an
 * opaque card with an intent-colored left accent (`data-color`), an optional
 * title, the message (`children`), and an optional dismiss button.
 */
export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  { color, title, onClose, urgent, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="toast"
      data-color={color}
      role={urgent ? 'alert' : 'status'}
    >
      <div data-civitai-ui-toast-body="">
        {title != null ? <div data-civitai-ui-toast-title="">{title}</div> : null}
        {children}
      </div>
      {onClose != null ? (
        <button
          type="button"
          data-civitai-ui-toast-close=""
          aria-label="Dismiss"
          onClick={onClose}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});
