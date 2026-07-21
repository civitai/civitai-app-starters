import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';
import type { Gap } from './Stack.js';

export interface GroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap preset between children. Defaults to the CSS default (~8px). */
  gap?: Gap;
}

/** Horizontal flex layout (items center-aligned). Renders `data-civitai-ui="group"`. */
export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  { gap, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div ref={ref} {...rest} data-civitai-ui="group" data-gap={gap}>
      {children}
    </div>
  );
});
