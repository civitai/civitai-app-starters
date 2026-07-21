import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

export type CardPadding = 'sm' | 'md' | 'lg';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add a border. Defaults to `true`. */
  withBorder?: boolean;
  /** Inner padding preset. Defaults to `'md'`. */
  padding?: CardPadding;
}

/** Surface container. Renders `data-civitai-ui="card"`. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { withBorder = true, padding = 'md', children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="card"
      data-with-border={withBorder ? 'true' : undefined}
      data-padding={padding}
    >
      {children}
    </div>
  );
});
