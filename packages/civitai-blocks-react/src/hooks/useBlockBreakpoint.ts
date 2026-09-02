import { BREAKPOINT_KEYS, breakpoints, type BreakpointKey } from '@civitai/theme';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

/**
 * Width tier of the block's own box.
 *
 * `'base'` is "narrower than the smallest named breakpoint" (< 480px). The
 * `model.sidebar_top` slot and a 360px phone both land there, which is the
 * point: they are the same layout problem.
 *
 * Tier semantics follow Tailwind's — a tier applies AT its breakpoint and above
 * — matching civitai's px scale, NOT Mantine's `hiddenFrom`/`visibleFrom`.
 */
export type BlockSizeTier = 'base' | BreakpointKey;

/** Ascending tier order. `base` first; the rest follow `BREAKPOINT_KEYS`. */
const TIER_ORDER: readonly BlockSizeTier[] = ['base', ...BREAKPOINT_KEYS];

/**
 * Resolve a width in CSS pixels to a tier, against civitai's PX breakpoint scale
 * (`@civitai/theme`'s `breakpoints`: 480 / 768 / 1024 / 1184 / 1440).
 *
 * 🔴 That is deliberately NOT Mantine's stock em scale (576 / 768 / 992 / 1200 /
 * 1408), which agrees on `sm` alone. See `@civitai/theme`'s
 * `src/breakpoints.source.ts`.
 *
 * A non-finite or non-positive width (an unmeasured element, SSR, a
 * `display: none` ancestor) resolves to `'base'` — the most conservative tier.
 */
export function resolveBlockTier(width: number): BlockSizeTier {
  if (!Number.isFinite(width) || width <= 0) return 'base';
  let tier: BlockSizeTier = 'base';
  for (const key of BREAKPOINT_KEYS) {
    if (width >= breakpoints[key]) tier = key;
  }
  return tier;
}

export interface BlockBreakpoint {
  /**
   * The current tier. `'base'` while unmeasured — see `measured`.
   */
  tier: BlockSizeTier;
  /**
   * `false` until a `ResizeObserver` measurement has landed (SSR, and the first
   * client render before the observer fires).
   *
   * 🔴 THIS EXISTS BECAUSE `tier` ALONE IS LOSSY. An unmeasured width (0)
   * resolves to `'base'`, which is indistinguishable from a genuinely narrow
   * block. That is the right default for a block — the slot is narrow far more
   * often than not — but a caller doing something expensive or visually jarring
   * on the narrow branch (a structural DOM swap rather than a style change)
   * wants to defer it one frame rather than render it and immediately undo it.
   * Gate on `measured && below('sm')` for that; `below('sm')` alone otherwise.
   */
  measured: boolean;
  /** `true` when the block is at least as wide as `key`'s breakpoint. */
  atLeast: (key: BreakpointKey) => boolean;
  /** `true` when the block is narrower than `key`'s breakpoint. */
  below: (key: BreakpointKey) => boolean;
}

/**
 * Report the block's own width tier, so a block can branch on "am I narrow?"
 * without hand-rolling a media query.
 *
 * 🔴 CONTAINER QUERY, NOT A VIEWPORT MEDIA QUERY — and the difference is not
 * cosmetic. A block renders inside a sandboxed iframe whose width is whatever
 * slot the host gave it, and SLOT WIDTH IS NOT MONOTONIC IN VIEWPORT WIDTH: the
 * `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a
 * 1440px one. A `matchMedia('(min-width: 768px)')` inside the frame would
 * therefore answer a question nobody asked. Observing the element instead — by
 * default `document.documentElement`, which inside the sandbox IS the slot the
 * host handed us — makes this a container query against the real box.
 *
 * This mirrors the reasoning already reviewed and written down on the host side
 * in civitai's `src/components/AppBlocks/chromeGeometry.ts` ("THE MEASURED BOX IS
 * THE CHROME'S OWN ELEMENT, NOT THE VIEWPORT"). Same mechanism, same scale,
 * pointed at the block's box instead of the chrome's.
 *
 * RE-RENDER SAFETY. A `ResizeObserver` fires on every pixel. This hook stores
 * the resolved TIER, not the width, and returns the same object identity while
 * the tier is unchanged — so dragging a window edge across 200px inside one tier
 * re-renders the block ZERO times. That is also why the raw width is not part of
 * the return value: exposing it would either force a render per pixel or be a
 * lie (a width that only updates when the tier changes).
 *
 * SSR-safe: with no `ResizeObserver` (or no `document`) the hook stays at
 * `{ tier: 'base', measured: false }` and never touches the DOM.
 *
 * @param ref - Optional element to measure instead of the sandbox document
 *   element. Pass this to ask about a nested container (e.g. one column of a
 *   split layout), or in a test where the viewport is fixed. The wrapper object
 *   may be recreated freely — the observer keys on the ELEMENT, not on the ref's
 *   identity — and an element that mounts later is picked up.
 *
 * @example
 * const bp = useBlockBreakpoint();
 * return (
 *   <div style={{ display: 'flex', flexDirection: bp.below('sm') ? 'column' : 'row' }}>
 *     {bp.atLeast('md') && <aside>…</aside>}
 *   </div>
 * );
 */
export function useBlockBreakpoint(ref?: RefObject<HTMLElement | null>): BlockBreakpoint {
  // `null` means UNMEASURED — distinct from a measured `'base'`. See `measured`.
  const [tier, setTier] = useState<BlockSizeTier | null>(null);

  // 🔴 THE EFFECT MUST NOT DEPEND ON THE REF WRAPPER'S IDENTITY. Unlike
  // `useBlockResize`, this hook RE-RENDERS its caller, so a `[ref]` dependency
  // turns a caller who writes `useBlockBreakpoint({ current: el })` inline into
  // a tear-down/re-observe on every render — and, worse, re-runs the
  // `apply(el.clientWidth)` seed each time, which re-reports a stale width. So
  // the wrapper is held in a mutable ref (never a dependency) and the effect
  // keys on the observed ELEMENT, which is the thing that actually matters and
  // which also picks up an element that mounts later.
  const refHolder = useRef(ref);
  refHolder.current = ref;
  const target = ref === undefined ? undefined : ref.current;

  // Last tier we pushed into state. 🔴 THE DEDUPE HAPPENS HERE, NOT VIA A
  // `setTier(prev => prev === next ? prev : next)` BAIL-OUT: React's same-value
  // bail-out is documented to still re-render the component ONE more time before
  // it takes effect, so the first no-op resize after a real tier change would
  // still cost a render. Same `lastHeight` idiom as `useBlockResize`.
  const lastTier = useRef<BlockSizeTier | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const caller = refHolder.current;
    const el = caller
      ? caller.current
      : typeof document === 'undefined'
        ? null
        : document.documentElement;
    if (!el) return;

    const apply = (width: number) => {
      const next = resolveBlockTier(width);
      // The whole re-render guard: only a TIER CHANGE reaches the block.
      if (lastTier.current === next) return;
      lastTier.current = next;
      setTier(next);
    };

    const observer = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    observer.observe(el);
    // Seed synchronously from layout: `observe()` schedules its first callback,
    // and without this the block paints one frame at `measured: false` even
    // though the width is already knowable.
    apply(el.clientWidth);

    return () => observer.disconnect();
  }, [target]);

  return useMemo(() => {
    const resolved: BlockSizeTier = tier ?? 'base';
    const index = TIER_ORDER.indexOf(resolved);
    const atLeast = (key: BreakpointKey) => index >= TIER_ORDER.indexOf(key);
    return {
      tier: resolved,
      measured: tier !== null,
      atLeast,
      below: (key: BreakpointKey) => !atLeast(key),
    };
  }, [tier]);
}
