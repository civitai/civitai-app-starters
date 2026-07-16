import { forwardRef, useRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type SegmentedControlSize = 'sm' | 'md' | 'lg';

/** One segment for the declarative `data` prop. */
export interface SegmentedControlItem {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** The segments, in display order. */
  data: SegmentedControlItem[];
  /** Current value (controlled). */
  value: string;
  /** Fires with the newly-selected segment's value. */
  onChange: (value: string) => void;
  /** Stretch to the container width; segments become equal-width. */
  fullWidth?: boolean;
  /** Size preset. Defaults to `'md'`, mirroring `<Button>` sizes. */
  size?: SegmentedControlSize;
  /** Disable the whole control (every segment). */
  disabled?: boolean;
  /** Accessible name for the group when there's no visible label. */
  'aria-label'?: string;
}

/**
 * Horizontal view / tab switcher — the `role="tablist"` primitive block authors
 * previously hand-rolled as a Group-of-Buttons. Controlled: pass `value` +
 * `onChange(value)`. Each segment is a `role="tab"` button; ArrowLeft/ArrowRight
 * rove selection across the enabled segments (a11y expectation for a tablist).
 * Auto-themed via `useBlocksStyles()`; the `data-size` / `data-full-width`
 * attributes drive the injected CSS.
 *
 * @example
 * <SegmentedControl
 *   aria-label="Gallery view"
 *   value={view}
 *   onChange={setView}
 *   data={[
 *     { value: 'grid', label: 'Grid' },
 *     { value: 'list', label: 'List' },
 *   ]}
 * />
 */
export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(
    {
      data,
      value,
      onChange,
      fullWidth = false,
      size = 'md',
      disabled = false,
      onKeyDown,
      ...rest
    },
    ref
  ): React.JSX.Element {
    useBlocksStyles();
    // Refs to each segment button, so a keyboard rove can move DOM focus to the
    // newly-selected tab (roving tabindex).
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // Move selection to the next enabled segment in `dir` (+1 / -1), wrapping.
    // Returns the resolved index, or -1 if no enabled segment exists.
    const moveTo = (fromIndex: number, dir: 1 | -1): number => {
      const n = data.length;
      for (let step = 1; step <= n; step++) {
        const i = (fromIndex + dir * step + n * step) % n;
        const item = data[i];
        if (item && !item.disabled) return i;
      }
      return -1;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (!disabled && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const current = data.findIndex((item) => item.value === value);
        const from = current === -1 ? 0 : current;
        const next = moveTo(from, e.key === 'ArrowRight' ? 1 : -1);
        const nextItem = next === -1 ? undefined : data[next];
        if (nextItem && nextItem.value !== value) {
          e.preventDefault();
          onChange(nextItem.value);
          tabRefs.current[next]?.focus();
        }
      }
      onKeyDown?.(e);
    };

    return (
      <div
        ref={ref}
        // Spread author props FIRST so the component-owned attributes below win —
        // an author must not clobber data-civitai-ui (the stylesheet selector)
        // or role via a stray spread prop.
        {...rest}
        data-civitai-ui="segmented-control"
        data-size={size}
        data-full-width={fullWidth ? 'true' : undefined}
        data-disabled={disabled ? 'true' : undefined}
        role="tablist"
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
      >
        {data.map((item, i) => {
          const selected = item.value === value;
          const isDisabled = disabled || item.disabled;
          return (
            <button
              key={item.value}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              data-civitai-ui-segment
              aria-selected={selected}
              data-active={selected || undefined}
              disabled={isDisabled}
              // Roving tabindex: only the selected tab is in the tab order.
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (isDisabled || selected) return;
                onChange(item.value);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }
);
