import { useEffect, useState } from 'react';

import { DIRECT_LOAD_TIMEOUT_MS } from '../internal/directLoad.js';
import { useTransportSnapshot } from './useBlockContext.js';

export interface UseDirectLoadOptions {
  /**
   * Milliseconds to wait for `BLOCK_INIT` before treating a top-level load as a
   * direct (unembedded) load. Defaults to {@link DIRECT_LOAD_TIMEOUT_MS}.
   */
  timeoutMs?: number;
}

/**
 * True iff the current window is the TOP-LEVEL browsing context — i.e. the
 * block is NOT running inside an iframe.
 *
 * Uses the `window.self === window.top` IDENTITY comparison, which is always
 * safe: it never reads a property off a (potentially cross-origin) parent, so
 * it cannot throw a SecurityError the way `window.top.location` would. When
 * embedded in the civitai host, `window.top` is the host's top frame — a
 * different object — so this is `false`; when loaded directly it is `true`.
 */
function isTopLevel(): boolean {
  if (typeof window === 'undefined') return false; // SSR / no DOM → not a direct browser load
  try {
    return window.self === window.top;
  } catch {
    // Defensive: if some exotic engine throws on the identity read, treat it as
    // embedded (fail safe — never show the fallback to a genuinely-framed block).
    return false;
  }
}

/**
 * Detect a DIRECT (unembedded) top-level load of a block and, after a short
 * grace period, report it so the SDK can show an "Open on Civitai" fallback
 * instead of hanging on the perpetual loading state.
 *
 * Returns `true` ONLY when BOTH hold:
 *  1. The block is TOP-LEVEL (`window.self === window.top` — not in the host
 *     iframe), AND
 *  2. No `BLOCK_INIT` has landed (`ready` is still `false`) within `timeoutMs`.
 *
 * This is precise by construction:
 *  - An EMBEDDED block (framed) is never top-level → always `false`, even before
 *    `ready`. The embedded happy path is untouched.
 *  - The dev harness / `createMockHost` runs the block top-level BUT posts
 *    `BLOCK_INIT` immediately (a `setTimeout(0)` macrotask), so `ready` flips
 *    long before `timeoutMs` and the timer is cleared → always `false`. The dev
 *    flow is untouched.
 *  - A real direct load (nobody sends `BLOCK_INIT`) stays top-level + not-ready
 *    past `timeoutMs` → `true`.
 *
 * Once `ready` flips it stays authoritative: this can never return `true` while
 * `ready` is `true`, so a late init can't leave a stuck fallback.
 */
export function useDirectLoad(options?: UseDirectLoadOptions): boolean {
  const timeoutMs = options?.timeoutMs ?? DIRECT_LOAD_TIMEOUT_MS;
  const ready = useTransportSnapshot().ready;
  // Sampled once per mount — top-level-ness doesn't change during a page's life.
  const [topLevel] = useState<boolean>(isTopLevel);
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    // No timer needed when embedded, or once BLOCK_INIT has already landed.
    if (ready || !topLevel) return;
    const id = setTimeout(() => setElapsed(true), timeoutMs);
    return () => clearTimeout(id);
  }, [ready, topLevel, timeoutMs]);

  return topLevel && !ready && elapsed;
}
