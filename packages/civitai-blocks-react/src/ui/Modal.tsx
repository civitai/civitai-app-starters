import { useEffect, useId, useRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  /** Whether the modal is shown. When `false`, nothing is rendered. */
  opened: boolean;
  /**
   * Called when the user requests close — Escape, overlay click, or the
   * header close button. The parent owns `opened`, so it must flip it.
   */
  onClose: () => void;
  /** Optional header title (also wires `aria-labelledby`). */
  title?: React.ReactNode;
  /** Panel width preset. Defaults to `'md'`. */
  size?: ModalSize;
  /** Show the header close (×) button. Defaults to `true`. */
  withCloseButton?: boolean;
  /** Close when the dimmed overlay (outside the panel) is clicked. Default `true`. */
  closeOnOverlayClick?: boolean;
  /** Close when Escape is pressed. Default `true`. */
  closeOnEscape?: boolean;
  /** Accessible label for the close button. Defaults to "Close". */
  closeButtonLabel?: string;
  /** Class applied to the panel element. */
  className?: string;
  /** Style applied to the panel element. */
  style?: React.CSSProperties;
  /** Modal body content. */
  children?: React.ReactNode;
}

/**
 * A lightweight modal dialog.
 *
 * `position: fixed` overlay covers the iframe viewport — correct here, since
 * the iframe IS the block's surface (no host bleed-through to worry about).
 *
 * Accessibility: `role="dialog"` + `aria-modal="true"`, `aria-labelledby` when
 * a `title` is given. On open the panel is focused and the previously-focused
 * element is restored on close. Escape and overlay-click both call `onClose`;
 * a click inside the panel does NOT.
 *
 * v0 limitation (documented): this does NOT trap focus inside the panel — Tab
 * can still reach content behind the overlay. Sufficient for a simple
 * confirm/settings dialog inside the sandboxed block; a full focus-trap is a
 * v1 follow-up (kept dependency-free here on purpose).
 */
export function Modal(props: ModalProps): React.JSX.Element | null {
  const {
    opened,
    onClose,
    title,
    size = 'md',
    withCloseButton = true,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    closeButtonLabel = 'Close',
    className,
    style,
    children,
  } = props;

  useBlocksStyles();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);
  const reactId = useId();
  const titleId = `ci-modal-title-${reactId}`;

  // Focus the panel on open; restore focus to the prior element on close.
  useEffect(() => {
    if (!opened) return;
    previouslyFocused.current =
      typeof document !== 'undefined' ? document.activeElement : null;
    // Focus after paint so the element exists and is focusable.
    panelRef.current?.focus();
    return () => {
      const prev = previouslyFocused.current;
      if (prev instanceof HTMLElement) prev.focus();
    };
  }, [opened]);

  // Escape-to-close. Listener only attached while open.
  useEffect(() => {
    if (!opened || !closeOnEscape) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [opened, closeOnEscape, onClose]);

  if (!opened) return null;

  return (
    <div
      data-civitai-ui="modal-overlay"
      onMouseDown={(e) => {
        // Only close on a click that starts AND lands on the overlay itself —
        // a drag that began inside the panel and released on the overlay must
        // not close it.
        if (closeOnOverlayClick && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={className}
        data-civitai-ui="modal"
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        tabIndex={-1}
        style={style}
      >
        {title != null || withCloseButton ? (
          <div data-civitai-ui-modal-header>
            {title != null ? (
              <h2 id={titleId} data-civitai-ui-modal-title>
                {title}
              </h2>
            ) : (
              <span />
            )}
            {withCloseButton ? (
              <button
                type="button"
                data-civitai-ui-modal-close
                aria-label={closeButtonLabel}
                onClick={() => onClose()}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <div data-civitai-ui-modal-body>{children}</div>
      </div>
    </div>
  );
}
