import { createElement, forwardRef } from 'react';

import { CivitaiStack, GAP_STEPS } from '@civitai/elements/stack';

/**
 * ── STRANGLER SEAM #1 ─────────────────────────────────────────────────────
 *
 * This component's markup now comes from `<civitai-stack>` in
 * `@civitai/elements`; the React file that remains is a COMPATIBILITY SHIM.
 * It exists so the migration is a sequence of small, reviewable steps rather
 * than one cutover: `@civitai/blocks-react/ui`'s public API does not change,
 * its tests do not change, and consumers do not change — but the DOM, the CSS
 * and the behaviour are the new package's.
 *
 * What the shim preserves, exactly:
 *   - the `StackProps` contract (`gap?: string | number`, default 12),
 *   - `style.gap` as an INLINE length for numeric/length gaps, because that is
 *     what the shipped contract does and what six existing tests assert,
 *   - `data-civitai-ui="stack"`, so any consumer CSS selecting on the
 *     attribute keeps matching,
 *   - a forwarded ref, `className`, and every spread prop.
 *
 * What it QUIETLY FIXES on the way through: a named step (`gap="md"`) is
 * routed to the element's `gap` ATTRIBUTE instead of `style.gap`. Under the
 * old implementation `gap="md"` typechecked (the prop is `string | number`),
 * emitted `style="gap: md"`, was dropped by the CSS parser, and produced the
 * default spacing with no error anywhere — the exact trap created by
 * `@civitai/components-react`'s Stack typing the same prop as
 * `'sm' | 'md' | 'lg'`. Five of six audited apps import both packages.
 *
 * The one type change: the forwarded ref is `HTMLElement` rather than
 * `HTMLDivElement`, because the rendered node is a `<civitai-stack>`. A
 * consumer's `useRef<HTMLDivElement>(null)` still assigns (object property
 * types are covariant), but code that reads `.tagName === 'DIV'` will notice.
 *
 * NEXT SEAMS, in the order they get cheaper: `Group` (same shape), `Card`
 * (one existing test asserts `tagName === 'DIV'` and must be updated first),
 * then `Button`, then the field components once `civitai-text-input` exists.
 */

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children (any CSS length, a number → px, or a named step). Defaults to 12. */
  gap?: string | number;
  /** `align-items` value. */
  align?: React.CSSProperties['alignItems'];
  /** `justify-content` value. */
  justify?: React.CSSProperties['justifyContent'];
}

const STEPS: ReadonlySet<string> = new Set<string>(GAP_STEPS);

function toLength(v: string | number | undefined): string | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? `${v}px` : v;
}

/**
 * Vertical flex container. Renders `<civitai-stack>` from `@civitai/elements`.
 */
export const Stack = forwardRef<HTMLElement, StackProps>(function Stack(
  { gap = 12, align, justify, style, children, ...rest },
  ref
): React.JSX.Element {
  const named = typeof gap === 'string' && STEPS.has(gap);
  // `createElement` rather than JSX so this package needs no JSX-intrinsics
  // augmentation (that lives in @civitai/elements-react, which React consumers
  // opt into). The element class is imported for its define() side effect.
  void CivitaiStack;
  return createElement(
    'civitai-stack',
    {
      ref,
      ...rest,
      'data-civitai-ui': 'stack',
      gap: named ? gap : undefined,
      style: {
        gap: named ? undefined : toLength(gap),
        alignItems: align,
        justifyContent: justify,
        ...style,
      },
    },
    children
  );
});
