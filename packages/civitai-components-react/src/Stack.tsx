import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type Gap = 'sm' | 'md' | 'lg';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap preset between children. Defaults to the CSS default (~12px). */
  gap?: Gap;
}

/** Vertical flex layout. Renders `data-civitai-ui="stack"`. */
export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div ref={ref} {...rest} data-civitai-ui="stack" data-gap={gap}>
      {children}
    </div>
  );
});
