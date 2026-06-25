import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type AlertColor = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'color' | 'title'> {
  /** Semantic color. Defaults to `'info'`. */
  color?: AlertColor;
  /** Optional bold title above the body. */
  title?: React.ReactNode;
  /** Render a close (×) button. Requires `onClose` to be meaningful. */
  withCloseButton?: boolean;
  /** Invoked when the close button is clicked. */
  onClose?: () => void;
  /** Accessible label for the close button. Defaults to "Close alert". */
  closeButtonLabel?: string;
}

/**
 * A themed callout. Carries `role="alert"` so it's announced. Optional
 * dismiss button calls `onClose`. Auto-themed via `useBlocksStyles()`.
 */
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  {
    color = 'info',
    title,
    withCloseButton = false,
    onClose,
    closeButtonLabel = 'Close alert',
    children,
    ...rest
  },
  ref
): React.JSX.Element {
  useBlocksStyles();
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="alert"
      data-color={color}
      role="alert"
    >
      <div data-civitai-ui-alert-body>
        {title != null ? (
          <div data-civitai-ui-alert-title>{title}</div>
        ) : null}
        {children}
      </div>
      {withCloseButton ? (
        <button
          type="button"
          data-civitai-ui-alert-close
          aria-label={closeButtonLabel}
          onClick={() => onClose?.()}
        >
          ×
        </button>
      ) : null}
    </div>
  );
});
