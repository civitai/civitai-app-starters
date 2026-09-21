import { render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
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

  /**
   * 🔴 THE LATER-MOUNT CASE. Every block in `starters/` renders a loading
   * skeleton until `BLOCK_INIT` lands, so the element this hook is asked to
   * observe DOES NOT EXIST on the first render. An effect keyed on the ref
   * WRAPPER (`[ref]`) runs once, finds `ref.current === null`, and is never
   * re-run — so the block never observes anything and the host never resizes
   * the iframe. The starters papered over that by pinning `ref={rootRef}` to
   * BOTH branches; these two cases are what make that unnecessary.
   *
   * Two shapes, because they fail for different reasons and one alone would
   * certify the fix too generously:
   *   - the hook-level shape, matching `useBlockBreakpoint`'s own later-mount
   *     test, where the caller re-renders with the element already in the ref;
   *   - the REAL component shape, where React attaches the ref during commit,
   *     i.e. AFTER the render that mounts it. That one is the shape the
   *     starters actually have.
   */
  it('picks up an element that only mounts on a later render', () => {
    installMockResizeObserver();
    const el = document.createElement('div');
    let current: HTMLElement | null = null;
    const { rerender } = renderHook(() => useBlockResize({ current }));

    expect(roInstances, 'nothing to observe yet').toHaveLength(0);

    current = el;
    rerender();

    expect(roInstances, 'the later-mounted element must be observed').toHaveLength(1);
    expect(roInstances[0].observe).toHaveBeenCalledWith(el);

    roInstances[0].cb([{ contentRect: { height: 250 } }]);
    expect(resizeMessages().map((m) => m.payload.height)).toEqual([250]);
  });

  it('posts RESIZE_IFRAME for a root that a real component mounts on a later render', () => {
    installMockResizeObserver();

    // The starter shape, with NO `ref` on the loading branch — exactly what the
    // workaround existed to avoid. React attaches `rootRef` during the commit
    // that follows the `ready = true` render, not during that render itself.
    function Block({ ready }: { ready: boolean }) {
      const rootRef = useRef<HTMLDivElement>(null);
      useBlockResize(rootRef);
      if (!ready) return <div>Loading…</div>;
      return <div ref={rootRef}>content</div>;
    }

    const { rerender } = render(<Block ready={false} />);
    expect(roInstances, 'nothing to observe while loading').toHaveLength(0);

    rerender(<Block ready />);

    expect(roInstances, 'the real root must be observed once it mounts').toHaveLength(1);
    roInstances[0].cb([{ contentRect: { height: 412 } }]);
    expect(
      resizeMessages().map((m) => m.payload.height),
      'the host must be told the real height',
    ).toEqual([412]);
  });

  /**
   * INVARIANT GUARDS, not regression coverage — both of these already pass at
   * `main` @ 0b6055b. They are here because the later-mount fix replaces the
   * effect's dependency array with a per-render identity check, and without
   * them nothing pins what that check is for: deleting it leaves every test
   * above green while the observer is torn down and rebuilt on every render.
   */
  it('does not rebuild the observer when the element is unchanged across renders', () => {
    installMockResizeObserver();

    function Block({ n }: { n: number }) {
      const rootRef = useRef<HTMLDivElement>(null);
      useBlockResize(rootRef);
      return <div ref={rootRef}>{n}</div>;
    }

    const { rerender } = render(<Block n={1} />);
    expect(roInstances).toHaveLength(1);

    rerender(<Block n={2} />);
    rerender(<Block n={3} />);

    expect(roInstances, 'same element -> one observer for its whole life').toHaveLength(1);
    expect(roInstances[0].disconnect, 'and it is never disconnected').not.toHaveBeenCalled();
  });

  it('disconnects the old observer and observes the new one when the element changes', () => {
    installMockResizeObserver();
    const first = document.createElement('div');
    const second = document.createElement('div');
    let current: HTMLElement = first;

    function Block() {
      const stable = useRef<HTMLElement | null>(null);
      stable.current = current;
      useBlockResize(stable);
      return null;
    }

    const { rerender } = render(<Block />);
    expect(roInstances[0].observe).toHaveBeenCalledWith(first);

    current = second;
    rerender(<Block />);

    expect(roInstances).toHaveLength(2);
    expect(roInstances[0].disconnect, 'the old element is released').toHaveBeenCalledTimes(1);
    expect(roInstances[1].observe).toHaveBeenCalledWith(second);
  });
});
