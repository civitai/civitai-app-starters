import { useEffect, useRef, type RefObject } from 'react';

import { getTransport } from '../internal/singleton.js';

/**
 * Observes the referenced element's height and asks the host to resize on
 * every change. Attach to the block's root DOM element.
 *
 * The ResizeObserver runs on both transports — only the outbound
 * `RESIZE_IFRAME` message differs:
 * - Iframe path: posts `RESIZE_IFRAME` with the integer-rounded height.
 * - Inline path: `InlineTransport.sendMessage` is a no-op (the host DOM
 *   reflows naturally), so the observer fires but no message goes out.
 *
 * 🔴 THE ELEMENT MAY MOUNT ON A LATER RENDER, AND THAT IS THE NORMAL CASE.
 * Every block renders a skeleton until `BLOCK_INIT` lands, so on the first
 * render there is nothing to observe. This hook therefore keys on the OBSERVED
 * ELEMENT, not on the ref wrapper's identity — the same reasoning written down
 * at `useBlockBreakpoint.ts`'s effect, with one mechanical difference that
 * matters:
 *
 *   `useBlockBreakpoint` can compare `ref.current` read DURING RENDER, because
 *   it re-renders its own caller and so always gets another render in which to
 *   notice. This hook re-renders nobody. React attaches a ref during COMMIT,
 *   i.e. AFTER the render that mounts it, so a `[ref.current]` dependency read
 *   during render is a render behind and — with no further render coming —
 *   never catches up. Measured: with `[ref.current]` as the dependency, a
 *   component that mounts its root on the second render still observes
 *   nothing.
 *
 * So the effect runs on every render (no dependency array) and does its own
 * identity check against the element it is already observing. The check is a
 * reference compare; the observer is torn down and rebuilt only when the
 * element actually changes.
 *
 * Because of this, a block does NOT need to pin the same `ref` to every branch
 * of a loading/ready conditional to keep the host resizing. That workaround was
 * load-bearing before this fix and is not any more.
 *
 * @param ref - Ref to the block's root DOM element to observe.
 *
 * @example
 * const rootRef = useRef<HTMLDivElement>(null);
 * useBlockResize(rootRef);              // host fits the iframe to content
 * if (!ready) return <div>Loading…</div>;   // no ref needed on this branch
 * return <div ref={rootRef}>…</div>;
 */
export function useBlockResize(ref: RefObject<HTMLElement | null>): void {
  /** The element the live observer is watching. `null` = watching nothing. */
  const observedRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // Unmount-only teardown. Declared FIRST so that on a remount (React
  // StrictMode's deliberate double-invoke) its cleanup — which clears
  // `observedRef` — runs before the observe effect's setup re-runs and finds a
  // clean slate. React runs every cleanup before any setup.
  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observedRef.current = null;
    };
  }, []);

  // No dependency array on purpose — see the block comment above. The identity
  // check below, not a dependency list, is what makes this cheap.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    const el = ref.current;
    if (el === observedRef.current) return; // already observing exactly this

    observerRef.current?.disconnect();
    observerRef.current = null;
    observedRef.current = el;
    if (!el) return;

    const transport = getTransport();
    let lastHeight = -1;
    const observer = new ResizeObserver((entries) => {
      const height = Math.ceil(entries[0]?.contentRect.height ?? el.offsetHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      transport.sendMessage({ type: 'RESIZE_IFRAME', payload: { height } });
    });
    observer.observe(el);
    observerRef.current = observer;
  });
}
