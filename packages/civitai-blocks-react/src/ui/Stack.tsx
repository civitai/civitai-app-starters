import { forwardRef } from 'react';

import { useBlocksStyles } from './styles.js';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children (any CSS length, or a number → px). Defaults to 12. */
  gap?: string | number;
  /** `align-items` value. */
  align?: React.CSSProperties['alignItems'];
  /** `justify-content` value. */
  justify?: React.CSSProperties['justifyContent'];
}

function toLength(v: string | number | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

/**
 * Vertical flex container. Wraps a `<div>` (ref-forwarded). Auto-themed.
 */
export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 12, align, justify, style, children, ...rest },
  ref
): React.JSX.Element {
  useBlocksStyles();
  return (
    <div
      ref={ref}
      data-civitai-ui="stack"
      style={{
        gap: toLength(gap),
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});
