import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { useBlockResize } from '../src/hooks/useBlockResize.js';
import { getTransport } from '../src/internal/singleton.js';
import { resetTransport } from '../src/testing.js';

/**
 * `useBlockResize` observes an element's height and posts RESIZE_IFRAME on every
 * change. happy-dom does not run a real ResizeObserver, so we install a
 * controllable fake: capture the callback + the observed element, and a
 * `disconnect` spy, then drive height changes by hand.
 */

const PARENT_ORIGIN = 'https://civitai.com';

type RoCallback = (entries: Array<{ contentRect: { height: number } }>) => void;

interface MockRoInstance {
  cb: RoCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let roInstances: MockRoInstance[];
let originalRo: typeof ResizeObserver | undefined;

function buildInit(): BlockInitPayload {
  return {
    blockInstanceId: 'i',
    blockId: 'b',
    appId: 'app_test',
    token: { raw: 'jwt', scopes: [], expiresAt: new Date(Date.now() + 60_000).toISOString() },
    context: { slotId: 's' },
    settings: { publisherSettings: {}, userSettings: {} },
    viewer: null,
    theme: 'light',
    renderMode: 'iframe',
  };
}

function installMockResizeObserver() {
  roInstances = [];
  class MockResizeObserver {
    instance: MockRoInstance;
    constructor(cb: RoCallback) {
      this.instance = { cb, observe: vi.fn(), disconnect: vi.fn() };
      roInstances.push(this.instance);
    }
    observe(...args: unknown[]) {
      this.instance.observe(...args);
    }
    disconnect() {
      this.instance.disconnect();
    }
    unobserve() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
}

describe('useBlockResize', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalRo = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    postMessageMock = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [PARENT_ORIGIN] });
    // Init so the transport posts directly (parentOrigin captured); clear the
    // auto BLOCK_READY so only RESIZE_IFRAME messages remain.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'BLOCK_INIT', payload: buildInit() },
        origin: PARENT_ORIGIN,
      }),
    );
    postMessageMock.mockClear();
  });

  afterEach(() => {
    resetTransport();
    (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalRo;
  });

  function resizeMessages() {
    return postMessageMock.mock.calls
      .map((c) => c[0] as { type: string; payload: { height: number } })
      .filter((m) => m.type === 'RESIZE_IFRAME');
  }

  it('observes the ref element and posts RESIZE_IFRAME with the ceil-rounded height', () => {
    installMockResizeObserver();
    const el = document.createElement('div');
    renderHook(() => useBlockResize({ current: el }));

    expect(roInstances).toHaveLength(1);
    expect(roInstances[0].observe).toHaveBeenCalledWith(el);

    roInstances[0].cb([{ contentRect: { height: 120.2 } }]);
    const msgs = resizeMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].payload.height).toBe(121); // Math.ceil(120.2)
  });

  it('dedupes: an identical height does not post a second RESIZE_IFRAME', () => {
    installMockResizeObserver();
    const el = document.createElement('div');
    renderHook(() => useBlockResize({ current: el }));

    roInstances[0].cb([{ contentRect: { height: 100 } }]);
    roInstances[0].cb([{ contentRect: { height: 100 } }]); // same → skipped
    roInstances[0].cb([{ contentRect: { height: 140 } }]); // changed → posts

    const heights = resizeMessages().map((m) => m.payload.height);
    expect(heights).toEqual([100, 140]);
  });

  it('falls back to el.offsetHeight when the entry carries no contentRect height', () => {
    installMockResizeObserver();
    const el = document.createElement('div');
    Object.defineProperty(el, 'offsetHeight', { value: 77, configurable: true });
    renderHook(() => useBlockResize({ current: el }));

    // Entry with an undefined height (`entries[0]?.contentRect.height ?? el.offsetHeight`).
    roInstances[0].cb([{ contentRect: { height: undefined as unknown as number } }]);
    expect(resizeMessages()[0].payload.height).toBe(77);
  });

  it('disconnects the observer on unmount', () => {
    installMockResizeObserver();
    const el = document.createElement('div');
    const { unmount } = renderHook(() => useBlockResize({ current: el }));
    unmount();
    expect(roInstances[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the ref is null (no observer created)', () => {
    installMockResizeObserver();
    renderHook(() => useBlockResize({ current: null }));
    expect(roInstances).toHaveLength(0);
  });

  it('is a no-op when ResizeObserver is unavailable in the environment', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const el = document.createElement('div');
    // Should not throw and should post nothing.
    expect(() => renderHook(() => useBlockResize({ current: el }))).not.toThrow();
    expect(resizeMessages()).toHaveLength(0);
  });
});
