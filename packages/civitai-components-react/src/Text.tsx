import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

/**
 * The element rendered. There is no default `as` that is right for every case,
 * so `'p'` is the default only because a text primitive is prose first — a
 * heading is always an explicit choice, which is the point: `as` carries the
 * page's structure and `size` carries its design, and neither implies the other.
 */
export type TextAs = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';
/** `dimmed` plus the intent enum Alert, Badge and Toast already share. */
export type TextColor = 'dimmed' | 'info' | 'success' | 'warning' | 'error';

export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * The element to render. Defaults to `'p'`. A heading MUST be a real heading
   * element — this prop is how you say which level — because that is what puts
   * it in the document outline and a screen reader's heading list.
   */
  as?: TextAs;
  /** Size preset. Defaults to `'md'`. Says nothing about the heading level. */
  size?: TextSize;
  /** Weight preset. Defaults to `'normal'`. */
  weight?: TextWeight;
  /**
   * Text colour (maps to `data-color`). `dimmed` is secondary copy; the other
   * four are the intent set Alert and Badge use. Omitted ⇒ the body colour.
   */
  color?: TextColor;
}

/**
 * Headings, paragraphs and inline copy. Renders `data-civitai-ui="text"` on the
 * element `as` names.
 */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { as: As = 'p', size = 'md', weight = 'normal', color, children, ...rest },
  ref
): React.JSX.Element {
  useComponentStyles();
  return (
    <As
      // `as` widens the ref past HTMLParagraphElement, which is what a caller
      // holding an <h2> actually gets; the cast is the JSX-intrinsic union
      // refusing a single ref type, not a claim about the runtime.
      ref={ref as React.Ref<HTMLParagraphElement>}
      {...rest}
      data-civitai-ui="text"
      data-size={size}
      data-weight={weight}
      data-color={color}
    >
      {children}
    </As>
  );
});
