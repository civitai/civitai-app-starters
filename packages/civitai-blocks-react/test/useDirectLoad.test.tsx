import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useDirectLoad } from '../src/hooks/useDirectLoad.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

const ORIGIN = window.location.origin;
const TIMEOUT = 2000;

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'inst-1',
    blockId: 'b',
    appId: 'app_test',
    token: {
      raw: 'jwt-1',
      scopes: ['models:read:self'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
    context: { slotId: 'app.page' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: { id: 7, username: 'alice', status: 'active' },
    theme: 'dark',
    renderMode: 'iframe',
  };
}

/**
 * Force the current window to look TOP-LEVEL (`self === top`) or EMBEDDED
 * (`self !== top`) by overriding `window.top`. The hook samples this once on
 * mount via the `window.self === window.top` identity check, so callers set it
 * BEFORE rendering the hook.
 */
function setFrame(mode: 'top-level' | 'embedded') {
  const value = mode === 'top-level' ? window : ({ name: 'mock-host-top' } as unknown as Window);
  Object.defineProperty(window, 'top', { configurable: true, get: () => value });
}

function dispatchInit() {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'BLOCK_INIT', payload: buildInit() },
      origin: ORIGIN,
    }),
  );
}

describe('useDirectLoad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    // Prime the iframe transport (no inline bootstrap present).
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    resetTransport();
    // Restore the default top-level framing for the next test.
    setFrame('top-level');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('EMBEDDED (framed) never reports a direct load, even past the timeout', () => {
    setFrame('embedded');
    const { result } = renderHook(() => useDirectLoad());
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1000);
    });
    expect(result.current).toBe(false);
  });

  it('EMBEDDED with a BLOCK_INIT still never reports a direct load', () => {
    setFrame('embedded');
    const { result } = renderHook(() => useDirectLoad());
    act(() => {
      dispatchInit();
    });
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1000);
    });
    expect(result.current).toBe(false);
  });

  it('TOP-LEVEL with no BLOCK_INIT reports a direct load after the timeout', () => {
    setFrame('top-level');
    const { result } = renderHook(() => useDirectLoad());
    // Not yet — still within the grace period.
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });
    expect(result.current).toBe(true);
  });

  it('TOP-LEVEL but BLOCK_INIT arrives before the timeout (the dev-harness case) never trips', () => {
    setFrame('top-level');
    const { result } = renderHook(() => useDirectLoad());
    // Harness posts BLOCK_INIT quickly (setTimeout(0)); simulate it landing well
    // before the direct-load timeout.
    act(() => {
      vi.advanceTimersByTime(10);
      dispatchInit();
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1000);
    });
    expect(result.current).toBe(false);
  });

  it('respects the timeout boundary exactly', () => {
    setFrame('top-level');
    const { result } = renderHook(() => useDirectLoad({ timeoutMs: TIMEOUT }));
    act(() => {
      vi.advanceTimersByTime(TIMEOUT - 1);
    });
    expect(result.current).toBe(false); // one tick short → still loading
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true); // boundary crossed → fallback
  });

  it('honors a custom (shorter) timeout', () => {
    setFrame('top-level');
    const { result } = renderHook(() => useDirectLoad({ timeoutMs: 500 }));
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(true);
  });
});
