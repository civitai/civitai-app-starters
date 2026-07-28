import { forwardRef, useCallback, useId, useRef, useState } from 'react';

import { useComponentStyles } from './styles.js';

export type SegmentedControlSize = 'sm' | 'md' | 'lg';

export interface SegmentItem {
  /** Stable value emitted on selection. */
  value: string;
  /** Visible segment label. */
  label: React.ReactNode;
  /** Disable this segment (skipped by keyboard nav, not selectable). */
  disabled?: boolean;
  /**
   * Explicit id for the segment button. Defaults to the auto id
   * `segmentId(baseId, value)`. Set it when a `<TabPanel>` needs to
   * `aria-labelledby` this tab with a known id.
   */
  id?: string;
  /**
   * id of the tab panel this segment controls. Sets `aria-controls`; pair with a
   * `<TabPanel id={panelId} tabId={<this segment's id>} …>`.
   */
  panelId?: string;
}

export interface SegmentedControlProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  /** The segments. */
  data: SegmentItem[];
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled initial value (defaults to the first enabled segment). */
  defaultValue?: string;
  /** Fires with the newly-selected value. */
  onChange?: (value: string) => void;
  /** Size preset. Defaults to `'md'`. */
  size?: SegmentedControlSize;
  /** Accessible name (required for the tablist unless `aria-labelledby` is set). */
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** Segment id used for aria-controls/labelledby wiring. */
export function segmentId(baseId: string, value: string): string {
  return `${baseId}-seg-${value}`;
}

/**
 * Accessible segmented control / tablist. Renders `role="tablist"` with a
 * `role="tab"` button per item and implements the WAI-ARIA **roving tabindex**
 * (only the selected tab is in the tab order) + **arrow-key navigation**
 * (Left/Right/Up/Down wrap across enabled segments, Home/End jump to the ends),
 * with **selection following focus**. Segments may declare a `panelId` to set
 * `aria-controls`; pair with `<TabPanel>` for the tab-panel half.
 */
export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl(
    {
      data,
      value,
      defaultValue,
      onChange,
      size = 'md',
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      ...rest
    },
    ref
  ): React.JSX.Element {
    useComponentStyles();
    const baseId = useId();
    const isControlled = value != null;
    const firstEnabled = data.find((d) => !d.disabled)?.value ?? data[0]?.value ?? '';
    const [internal, setInternal] = useState<string>(defaultValue ?? firstEnabled);
    const selected = isControlled ? value! : internal;

    const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const select = useCallback(
      (next: string, focus: boolean) => {
        if (!isControlled) setInternal(next);
        onChange?.(next);
        if (focus) btnRefs.current[next]?.focus();
      },
      [isControlled, onChange]
    );

    const enabledValues = data.filter((d) => !d.disabled).map((d) => d.value);

    const onKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
        if (!keys.includes(e.key) || enabledValues.length === 0) return;
        e.preventDefault();
        const curIdx = Math.max(0, enabledValues.indexOf(selected));
        let nextIdx = curIdx;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIdx = (curIdx + 1) % enabledValues.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          nextIdx = (curIdx - 1 + enabledValues.length) % enabledValues.length;
        } else if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = enabledValues.length - 1;
        }
        const next = enabledValues[nextIdx];
        if (next != null) select(next, true);
      },
      [enabledValues, selected, select]
    );

    return (
      <div
        ref={ref}
        {...rest}
        data-civitai-ui="segmented-control"
        data-size={size}
        role="tablist"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        onKeyDown={onKeyDown}
      >
        {data.map((item) => {
          const isSelected = item.value === selected;
          return (
            <button
              key={item.value}
              ref={(el) => {
                btnRefs.current[item.value] = el;
              }}
              type="button"
              id={item.id ?? segmentId(baseId, item.value)}
              data-civitai-ui-segment
              data-size={size}
              role="tab"
              aria-selected={isSelected}
              aria-controls={item.panelId}
              tabIndex={isSelected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) select(item.value, true);
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
