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
 * hover or keyboard focus (CSS `:hover`/`:focus-within`), with `Escape` to
 * dismiss. Renders the `data-civitai-ui="tooltip"` contract.
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

  const existing = children.props['aria-describedby'];
  const describedBy = existing ? `${existing} ${tipId}` : tipId;
  const trigger = cloneElement(children, { 'aria-describedby': describedBy });

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  }, []);

  return (
    <span
      className={className}
      data-civitai-ui="tooltip"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      {trigger}
      <span
        data-civitai-ui-tooltip-bubble=""
        role="tooltip"
        id={tipId}
        data-open={open ? 'true' : undefined}
      >
        {label}
      </span>
    </span>
  );
}
