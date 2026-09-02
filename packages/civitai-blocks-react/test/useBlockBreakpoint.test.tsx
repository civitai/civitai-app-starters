import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveBlockTier,
  useBlockBreakpoint,
  type BlockSizeTier,
} from '../src/hooks/useBlockBreakpoint.js';

/**
 * `useBlockBreakpoint` resolves the block's OWN width to a tier on civitai's PX
 * breakpoint scale. happy-dom runs no layout and no real ResizeObserver, so this
 * suite installs a controllable fake (same idiom as `useBlockResize.test.tsx`)
 * and drives widths by hand. Real layout is covered by
 * `useBlockBreakpoint.browser.test.tsx`.
 *
 * 🔴 THE SCALE ASSERTIONS ARE BUILT FROM DISCRIMINATING WIDTHS, NOT ROUND
 * NUMBERS. civitai has two breakpoint scales that agree on `sm` (768) alone:
 *
 *     key   px (breakpoints.json — CORRECT)   Mantine stock em scale (WRONG)
 *     xs    480                               576
 *     sm    768                               768
 *     md    1024                              992
 *     lg    1184                              1200
 *     xl    1440                              1408
 *
 * So each width below is chosen to land in a DIFFERENT tier under the two
 * scales; an implementation wired to the em scale fails every one of them. A
 * table of round widths (e.g. 400/800/1200) would pass against either.
 */

type RoCallback = (entries: Array<{ contentRect: { width: number } }>) => void;

interface MockRoInstance {
  cb: RoCallback;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let roInstances: MockRoInstance[];
let originalRo: typeof ResizeObserver | undefined;

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

/** Drive the most recently created observer with a width. */
function emitWidth(width: number) {
  act(() => {
    roInstances[roInstances.length - 1]!.cb([{ contentRect: { width } }]);
  });
}

function elementOfWidth(width: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  return el;
}

beforeEach(() => {
  originalRo = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
});

afterEach(() => {
  (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalRo;
});

describe('resolveBlockTier — the PX scale, not the Mantine em scale', () => {
  // [width, px-scale tier (EXPECTED), em-scale tier (what a wrong impl gives)]
  const DISCRIMINATING: Array<[number, BlockSizeTier, BlockSizeTier]> = [
    [500, 'xs', 'base'], // px xs=480 vs em xs=576
    [1000, 'sm', 'md'], //  px md=1024 vs em md=992
    [1190, 'lg', 'md'], //  px lg=1184 vs em lg=1200
    [1420, 'lg', 'xl'], //  px xl=1440 vs em xl=1408
  ];

  for (const [width, expected, emWrong] of DISCRIMINATING) {
    it(`${width}px resolves to '${expected}' (the em scale would say '${emWrong}')`, () => {
      expect(
        resolveBlockTier(width),
        `${width}px must resolve on civitai's PX scale to '${expected}'; '${emWrong}' means the ` +
          `implementation is using Mantine's em scale`
      ).toBe(expected);
    });
  }

  it('768 is sm on BOTH scales — asserted for completeness, discriminates nothing', () => {
    expect(resolveBlockTier(768)).toBe('sm');
  });

  it('every px boundary applies AT the breakpoint and above (Tailwind semantics)', () => {
    const BOUNDARIES: Array<[number, BlockSizeTier]> = [
      [479, 'base'],
      [480, 'xs'],
      [767, 'xs'],
      [768, 'sm'],
      [1023, 'sm'],
      [1024, 'md'],
      [1183, 'md'],
      [1184, 'lg'],
      [1439, 'lg'],
      [1440, 'xl'],
      [4000, 'xl'],
    ];
    for (const [width, expected] of BOUNDARIES) {
      expect(resolveBlockTier(width), `${width}px`).toBe(expected);
    }
  });

  it("an unmeasured / nonsensical width resolves to the conservative 'base'", () => {
    for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(resolveBlockTier(width), String(width)).toBe('base');
    }
  });
});

describe('useBlockBreakpoint', () => {
  it('observes the passed ref element and reports its tier', () => {
    installMockResizeObserver();
    const el = elementOfWidth(0);
    const { result } = renderHook(() => useBlockBreakpoint({ current: el }));

    expect(roInstances).toHaveLength(1);
    expect(roInstances[0]!.observe).toHaveBeenCalledWith(el);

    emitWidth(1000);
    expect(result.current.tier).toBe('sm'); // px md=1024 → still sm
    expect(result.current.measured).toBe(true);
  });

  it('defaults to document.documentElement — the slot the host gave the sandbox', () => {
    installMockResizeObserver();
    renderHook(() => useBlockBreakpoint());
    expect(roInstances[0]!.observe).toHaveBeenCalledWith(document.documentElement);
  });

  it('atLeast/below bracket the tier on the px scale', () => {
    installMockResizeObserver();
    const el = elementOfWidth(0);
    const { result } = renderHook(() => useBlockBreakpoint({ current: el }));

    emitWidth(1000); // tier 'sm'
    expect(result.current.atLeast('xs')).toBe(true);
    expect(result.current.atLeast('sm')).toBe(true);
    expect(result.current.atLeast('md')).toBe(false);
    expect(result.current.below('md')).toBe(true);
    expect(result.current.below('sm')).toBe(false);

    emitWidth(500); // tier 'xs' — px xs=480; the em scale would leave this at 'base'
    expect(result.current.atLeast('xs')).toBe(true);
    expect(result.current.below('sm')).toBe(true);
  });

  it("'base' is below EVERY named breakpoint, including xs", () => {
    installMockResizeObserver();
    const el = elementOfWidth(0);
    const { result } = renderHook(() => useBlockBreakpoint({ current: el }));
    emitWidth(300);
    expect(result.current.tier).toBe('base');
    expect(result.current.below('xs')).toBe(true);
    expect(result.current.atLeast('xs')).toBe(false);
  });

  it('RE-RENDER GUARD: width changes WITHIN a tier re-render zero times', () => {
    installMockResizeObserver();
    const el = elementOfWidth(0);
    let renders = 0;
    // 🔴 The ref wrapper is deliberately RECREATED on every render here. That is
    // the shape that used to tear down and re-observe (and re-seed a stale
    // `clientWidth`) on each render, defeating the guard entirely — the effect
    // now keys on the ELEMENT, not the wrapper.
    const { result } = renderHook(() => {
      renders++;
      return useBlockBreakpoint({ current: el });
    });
    expect(roInstances, 'exactly one observer for one element').toHaveLength(1);

    emitWidth(800); // 'base' → 'sm': one render
    const afterFirstTierChange = renders;
    const identity = result.current;

    // 200px of drag entirely inside the `sm` band (768…1023).
    for (let w = 800; w < 1000; w += 10) emitWidth(w);

    expect(
      renders,
      'a ResizeObserver fires per pixel; only a TIER change may reach the block'
    ).toBe(afterFirstTierChange);
    expect(result.current, 'the returned object identity must be stable within a tier').toBe(
      identity
    );

    emitWidth(1024); // crosses into 'md' → exactly one more render
    expect(renders).toBe(afterFirstTierChange + 1);
    expect(result.current.tier).toBe('md');
    expect(result.current).not.toBe(identity);
    expect(roInstances, 'still exactly one observer after 22 resize events').toHaveLength(1);
  });

  it('disconnects the observer on unmount', () => {
    installMockResizeObserver();
    const el = elementOfWidth(0);
    const { unmount } = renderHook(() => useBlockBreakpoint({ current: el }));
    unmount();
    expect(roInstances[0]!.disconnect).toHaveBeenCalledTimes(1);
  });

  it('is inert with a null ref (no observer created), reporting unmeasured base', () => {
    installMockResizeObserver();
    const { result } = renderHook(() => useBlockBreakpoint({ current: null }));
    expect(roInstances).toHaveLength(0);
    expect(result.current.tier).toBe('base');
    expect(result.current.measured).toBe(false);
  });

  it('is SSR-safe: no ResizeObserver → unmeasured base, no throw', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
    const { result } = renderHook(() => useBlockBreakpoint());
    expect(result.current.tier).toBe('base');
    expect(result.current.measured).toBe(false);
    expect(result.current.below('xs')).toBe(true);
  });

  it('falls back to el.clientWidth when the entry carries no contentRect width', () => {
    installMockResizeObserver();
    const el = elementOfWidth(1190); // px lg=1184 → 'lg'; the em scale would say 'md'
    const { result } = renderHook(() => useBlockBreakpoint({ current: el }));
    act(() => {
      roInstances[0]!.cb([
        { contentRect: { width: undefined as unknown as number } },
      ]);
    });
    expect(result.current.tier).toBe('lg');
  });

  it('seeds from layout synchronously on mount, before the observer fires', () => {
    installMockResizeObserver();
    // The mock observer never auto-fires, so a non-base tier here can only have
    // come from the synchronous `apply(el.clientWidth)` seed.
    const el = elementOfWidth(1420);
    const { result } = renderHook(() => useBlockBreakpoint({ current: el }));
    expect(result.current.tier).toBe('lg'); // px xl=1440; the em scale would say 'xl'
    expect(result.current.measured).toBe(true);
  });

  it('picks up an element that only mounts on a later render', () => {
    installMockResizeObserver();
    const el = elementOfWidth(1000);
    let current: HTMLElement | null = null;
    const { rerender, result } = renderHook(() => useBlockBreakpoint({ current }));

    expect(roInstances, 'nothing to observe yet').toHaveLength(0);
    expect(result.current.measured).toBe(false);

    current = el;
    rerender();
    expect(roInstances).toHaveLength(1);
    expect(roInstances[0]!.observe).toHaveBeenCalledWith(el);
    expect(result.current.tier).toBe('sm');
  });
});
