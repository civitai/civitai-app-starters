import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export type CardPadding = 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Draw the themed border. Defaults to `true`. */
  withBorder?: boolean;
  /** Inner padding preset. Defaults to `'md'`. */
  padding?: CardPadding;
  /** Override the corner radius (any CSS length). Defaults to the token. */
  radius?: string | number;
}

/**
 * A themed surface container. Wraps a `<div>` (ref-forwarded). Auto-themed.
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { withBorder = true, padding = 'md', radius, style, children, ...rest },
  ref
): React.JSX.Element {
  useBlocksStyles();
  return (
    <div
      ref={ref}
      data-civitai-ui="card"
      data-with-border={withBorder ? 'true' : undefined}
      data-padding={padding}
      style={radius != null ? { borderRadius: radius, ...style } : style}
      {...rest}
    >
      {children}
    </div>
  );
});
