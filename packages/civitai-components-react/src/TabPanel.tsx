import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export interface TabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** id of the controlling `SegmentedControl` tab (sets `aria-labelledby`). */
  tabId?: string;
  /**
   * Whether this panel is the active one. When false the panel is `hidden`
   * (removed from the a11y tree + layout). Defaults to `true`.
   */
  active?: boolean;
}

/**
 * Tab panel for `SegmentedControl` used as tabs. Renders
 * `data-civitai-ui-tabpanel` with `role="tabpanel"`, `aria-labelledby` pointing
 * at its tab, `tabindex="0"` (so the panel is focusable per the tabs pattern),
 * and `hidden` when inactive. Wire `tabId` to the controlling segment's id
 * (`segmentId(baseId, value)`) and set the segment's `panelId` to this panel's
 * `id` for the reciprocal `aria-controls`.
 */
export const TabPanel = forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
  { tabId, active = true, hidden, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui-tabpanel=""
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={0}
      hidden={hidden ?? !active}
    >
      {children}
    </div>
  );
});
