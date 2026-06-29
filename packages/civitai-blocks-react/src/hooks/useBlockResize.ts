import { useEffect, type RefObject } from 'react';

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
 * @param ref - Ref to the block's root DOM element to observe.
 *
 * @example
 * const rootRef = useRef<HTMLDivElement>(null);
 * useBlockResize(rootRef);              // host fits the iframe to content
 * return <div ref={rootRef}>…</div>;
 */
export function useBlockResize(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') return;

    const transport = getTransport();
    let lastHeight = -1;
    const observer = new ResizeObserver((entries) => {
      const height = Math.ceil(entries[0]?.contentRect.height ?? el.offsetHeight);
      if (height === lastHeight) return;
      lastHeight = height;
      transport.sendMessage({ type: 'RESIZE_IFRAME', payload: { height } });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}
