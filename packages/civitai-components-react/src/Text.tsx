import { forwardRef } from 'react';

import { useComponentStyles } from './styles.js';

/**
 * The element rendered. There is no default `as` that is right for every case,
 * so `'p'` is the default only because a text primitive is prose first — a
 * heading is always an explicit choice, which is the point: `as` carries the
 * page's structure and `size` carries its design, and neither implies the other.
 */
export type TextAs = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
/**
 * ONE type scale, nine steps: `xs`–`lg` is the UI ramp (`sm`/`md`/`lg`
 * byte-identical to Button's), `xl`–`5xl` the heading ramp, and every value from
 * `lg` up is one `@civitai/components`' `utilities.css` already ships as
 * `ci-fs-N` — `lg`=`ci-fs-6` … `5xl`=`ci-fs-1`. The names do not encode `N` and
 * the two sequences run in opposite directions, which is the documented cost of
 * having one scale rather than two. Full table in `MARKUP.md`.
 */
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';

/*
 * `Omit<…, 'color'>` + `color?: never` is a DETERMINISTIC guard, not belt-and-
 * braces, and it closes a trap measured on this very change:
 * `React.HTMLAttributes<HTMLElement>` DECLARES `color` (the legacy presentation
 * attribute), so simply deleting the `color` prop did NOT make `<Text
 * color="dimmed">` a type error. It kept compiling, fell into `...rest`, and was
 * spread onto the DOM as a bare `color` attribute — which modern browsers ignore
 * on a `<p>`/`<span>`, so the text silently rendered in the body colour with no
 * error anywhere. One instance was already live in this repo's own fixtures and
 * every gate stayed green over it.
 *
 * Making it `never` turns that silent no-op into a compile error that names the
 * replacement. There is no legitimate use being taken away: the HTML `color`
 * attribute is deprecated and inert on these elements.
 */
export interface TextProps extends Omit<React.HTMLAttributes<HTMLElement>, 'color'> {
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
   * @deprecated Text has no colour axis. Use a utility class instead —
   * `className="ci-muted"` for secondary copy, `ci-text-info` / `-success` /
   * `-warning` / `-error` for the intent set, `ci-text-default` for the body
   * colour (from `@civitai/components/utilities.css`, which is a SEPARATE
   * stylesheet from `styles.css`). `color` inherits, so the class reaches the
   * text either way.
   */
  color?: never;
}

/**
 * Headings, paragraphs and inline copy. Renders `data-civitai-ui="text"` on the
 * element `as` names.
 *
 * NO `color` PROP, deliberately: every value one would take already exists as a
 * utility class that reaches this element by inheritance — `ci-muted`,
 * `ci-text-info` / `-success` / `-warning` / `-error`, `ci-text-default` — so
 * pass one in `className` instead. That is the same predicate this component
 * applies to alignment (`ci-text-center`) and truncation (`ci-truncate`), and
 * the direction that stays open: adding the prop later is additive on a
 * published package, removing it would not be.
 */
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  { as: As = 'p', size = 'md', weight = 'normal', children, ...rest },
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
    >
      {children}
    </As>
  );
});
