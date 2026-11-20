import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBlockBreakpoint, type BlockBreakpoint } from '../src/hooks/useBlockBreakpoint.js';

/**
 * REAL-LAYOUT harness for `useBlockBreakpoint` (vitest browser mode, headless
 * Chromium).
 *
 * WHY IT EXISTS: the happy-dom unit suite drives a FAKE `ResizeObserver` with
 * hand-fed widths, so it proves the tier arithmetic and the re-render guard but
 * proves nothing about the mechanism — happy-dom does no layout and runs no real
 * observer, so a hook that never actually observed anything would pass it.
 *
 * 🔴 A FIXED-WIDTH CONTAINER IS RESIZED, NOT THE VIEWPORT. This project pins
 * `viewport: { width: 800 }` in `vitest.config.ts`, and a suite whose config
 * fixes a dimension is structurally blind to bugs on that dimension. Sizing an
 * element instead means every tier from `base` to `xl` is reachable — including
 * widths WIDER than the 800px viewport, which is exactly the case a viewport
 * media query would get wrong and a container query gets right.
 *
 * The widths are the DISCRIMINATING ones (see the unit suite's table): each
 * lands in a different tier under civitai's px scale than under Mantine's em
 * scale, so an implementation wired to the wrong scale fails here too.
 */

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let box: HTMLDivElement | undefined;

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  host?.remove();
  box?.remove();
  root = undefined;
  host = undefined;
  box = undefined;
});

interface Harness {
  /** Set the observed container's width, in CSS px. */
  setWidth: (px: number) => void;
  /** Latest hook result. */
  read: () => BlockBreakpoint;
  /** How many times the consuming component has rendered. */
  renders: () => number;
}

/**
 * Mount a component whose observed box is a real, explicitly-sized element.
 *
 * 🔴 THE MEASURED BOX IS A SIBLING OF THE REACT ROOT CONTAINER, NOT A CHILD.
 * `createRoot(container).render(...)` CLEARS the container's existing children,
 * so a box appended to it before mounting is silently DETACHED — `clientWidth`
 * drops to 0 and the `ResizeObserver` never reports a width again. That reads
 * exactly like "the hook doesn't observe anything" (it cost this suite two runs).
 */
function mountSizedContainer(initialWidth: number): Harness {
  const el = document.createElement('div');
  el.style.width = `${initialWidth}px`;
  // Take the box out of normal flow so a width WIDER than the 800px viewport
  // lays out at its declared size instead of being constrained by the body.
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.height = '10px';
  document.body.appendChild(el);
  box = el;

  host = document.createElement('div');
  document.body.appendChild(host);

  let latest: BlockBreakpoint | undefined;
  let renders = 0;

  function Probe() {
    renders++;
    latest = useBlockBreakpoint({ current: el });
    return null;
  }

  root = createRoot(host);
  flushSync(() => root!.render(<Probe />));

  return {
    setWidth: (px: number) => {
      el.style.width = `${px}px`;
    },
    read: () => latest!,
    renders: () => renders,
  };
}

describe('useBlockBreakpoint in real layout', () => {
  it('tracks a real ResizeObserver across every tier, on the px scale', async () => {
    const h = mountSizedContainer(320);

    await vi.waitFor(() => expect(h.read().measured).toBe(true));
    expect(h.read().tier).toBe('base');
    expect(h.read().below('xs')).toBe(true);

    // 500px: px xs=480 → 'xs'. Mantine's em xs=576 would leave this at 'base'.
    h.setWidth(500);
    await vi.waitFor(() => expect(h.read().tier).toBe('xs'));

    // 1000px: px md=1024 → still 'sm'. em md=992 would say 'md'.
    // Also WIDER than the 800px viewport — a viewport query cannot see this.
    h.setWidth(1000);
    await vi.waitFor(() => expect(h.read().tier).toBe('sm'));

    // 1190px: px lg=1184 → 'lg'. em lg=1200 would still say 'md'.
    h.setWidth(1190);
    await vi.waitFor(() => expect(h.read().tier).toBe('lg'));

    // 1420px: px xl=1440 → still 'lg'. em xl=1408 would say 'xl'.
    h.setWidth(1420);
    // No tier change is expected here, so wait for the observer to have run and
    // then assert it did NOT move.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(h.read().tier).toBe('lg');

    h.setWidth(1440);
    await vi.waitFor(() => expect(h.read().tier).toBe('xl'));
    expect(h.read().atLeast('xl')).toBe(true);

    // Shrinking works too (the observer is not one-directional).
    h.setWidth(300);
    await vi.waitFor(() => expect(h.read().tier).toBe('base'));
  });

  it('does not re-render while a real resize stays inside one tier', async () => {
    const h = mountSizedContainer(800);
    await vi.waitFor(() => expect(h.read().tier).toBe('sm'));

    const before = h.renders();
    // 20 real layout changes, all inside the sm band (768…1023).
    for (let w = 800; w < 1000; w += 10) {
      h.setWidth(w);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    expect(
      h.renders(),
      'a real ResizeObserver fires on every layout change; only a TIER change may re-render the block'
    ).toBe(before);

    h.setWidth(1024);
    await vi.waitFor(() => expect(h.read().tier).toBe('md'));
    expect(h.renders()).toBe(before + 1);
  });

  it('defaults to the document element — a container query against the slot', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);

    let latest: BlockBreakpoint | undefined;
    function Probe() {
      latest = useBlockBreakpoint();
      return null;
    }
    root = createRoot(host);
    flushSync(() => root!.render(<Probe />));

    await vi.waitFor(() => expect(latest!.measured).toBe(true));
    // The browser project pins viewport.width: 800 → documentElement is 800 wide
    // → 'sm' on the px scale (768). Read the live width rather than hard-coding
    // it so a config change surfaces as a scale question, not a phantom failure.
    const docWidth = document.documentElement.clientWidth;
    expect(docWidth).toBeGreaterThan(0);
    expect(latest!.tier).toBe(docWidth >= 1024 ? 'md' : docWidth >= 768 ? 'sm' : 'base');
  });
});
