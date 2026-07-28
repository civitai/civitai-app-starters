import { cloneElement, useCallback, useId, useState } from 'react';

import { useComponentStyles } from './styles.js';

export interface TooltipProps {
  /** Tooltip text (kept short — it is supplementary, not the accessible name). */
  label: React.ReactNode;
  /** The single focusable trigger element the tooltip describes. */
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  /** Provide a stable id for the bubble (defaults to a generated one). */
  id?: string;
  /** Start open (mainly for docs/testing). */
  defaultOpen?: boolean;
  /** Class on the wrapper `<span>`. */
  className?: string;
}

/**
 * Hover/focus tooltip. Wraps a single focusable trigger, wires its
 * `aria-describedby` to a `role="tooltip"` bubble, and reveals the bubble on
 * hover or keyboard focus (CSS `:hover`/`:focus-within`). `Escape` genuinely
 * dismisses it: the binding sets `data-dismissed`, which overrides the CSS
 * reveal so the bubble hides even while the pointer still hovers / focus is
 * still within; the flag clears on the next hover/focus so it re-opens normally.
 * Renders the `data-civitai-ui="tooltip"` contract.
 */
export function Tooltip({
  label,
  children,
  id,
  defaultOpen = false,
  className,
}: TooltipProps): React.JSX.Element {
  useComponentStyles();
  const reactId = useId();
  const tipId = id ?? `ci-tooltip-${reactId}`;
  const [open, setOpen] = useState(defaultOpen);
  const [dismissed, setDismissed] = useState(false);

  const existing = children.props['aria-describedby'];
  const describedBy = existing ? `${existing} ${tipId}` : tipId;
  const trigger = cloneElement(children, { 'aria-describedby': describedBy });

  // A new hover/focus intent both opens the tooltip AND clears a prior dismissal.
  const reveal = useCallback(() => {
    setOpen(true);
    setDismissed(false);
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setDismissed(true);
    }
  }, []);

  return (
    <span
      className={className}
      data-civitai-ui="tooltip"
      onMouseEnter={reveal}
      onMouseLeave={() => setOpen(false)}
      onFocus={reveal}
      onBlur={() => {
        setOpen(false);
        setDismissed(false);
      }}
      onKeyDown={onKeyDown}
    >
      {trigger}
      <span
        data-civitai-ui-tooltip-bubble=""
        role="tooltip"
        id={tipId}
        data-open={open ? 'true' : undefined}
        data-dismissed={dismissed ? 'true' : undefined}
      >
        {label}
      </span>
    </span>
  );
}
