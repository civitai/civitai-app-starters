import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** `useLayoutEffect` warns during SSR, where there is no element to touch. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Assign props as PROPERTIES. Left to React, an un-upgraded element takes them
 * as attributes, so a boolean arrives as `""` and Lit's converter never runs.
 */
export function useProperties<T extends HTMLElement>(
  ref: RefObject<T | null>,
  properties: Record<string, unknown>
): void {
  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    for (const [key, value] of Object.entries(properties)) {
      if (value !== undefined) Reflect.set(element, key, value);
    }
  });
}

export function useEventListener<T extends HTMLElement>(
  ref: RefObject<T | null>,
  type: string,
  handler: ((event: Event) => void) | undefined
): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: Event): void => latest.current?.(event);
    element.addEventListener(type, listener);
    return () => element.removeEventListener(type, listener);
  }, [ref, type]);
}
