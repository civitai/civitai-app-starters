import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export interface GroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children (any CSS length, or a number → px). Defaults to 12. */
  gap?: string | number;
  /** `justify-content` value. */
  justify?: React.CSSProperties['justifyContent'];
  /** `align-items` value. Defaults to `'center'`. */
  align?: React.CSSProperties['alignItems'];
  /** Allow children to wrap onto multiple lines. Defaults to `true`. */
  wrap?: boolean;
}

function toLength(v: string | number | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

/**
 * Horizontal flex container. Wraps a `<div>` (ref-forwarded). Auto-themed.
 */
export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  { gap = 12, justify, align = 'center', wrap = true, style, children, ...rest },
  ref
): React.JSX.Element {
  useBlocksStyles();
  return (
    <div
      ref={ref}
      {...rest}
      data-civitai-ui="group"
      style={{
        gap: toLength(gap),
        justifyContent: justify,
        alignItems: align,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  );
});
