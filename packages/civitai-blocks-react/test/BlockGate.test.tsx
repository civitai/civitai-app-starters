import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { BlockGate, DirectLoadFallback } from '../src/ui/BlockGate.js';
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

/** The block app's own content — present exactly when the gate lets children through. */
function Child() {
  return <div data-testid="app-content">block app content</div>;
}

const fallbackShowing = () => document.querySelector('[data-civitai-block-direct-load]') != null;

describe('<BlockGate> / <DirectLoadFallback>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: vi.fn() },
      configurable: true,
      writable: true,
    });
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });

  afterEach(() => {
    cleanup();
    resetTransport();
    setFrame('top-level');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('EMBEDDED: renders children, never the fallback — the happy path is unchanged', () => {
    setFrame('embedded');
    render(
      <BlockGate hostname="model-benchmarking.civit.ai">
        <Child />
      </BlockGate>,
    );
    // Before BLOCK_INIT: children already render (gate is a pass-through when embedded),
    // and crucially NO fallback element exists.
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(fallbackShowing()).toBe(false);

    // BLOCK_INIT lands → still children, still no fallback.
    act(() => {
      dispatchInit();
    });
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1000);
    });
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(fallbackShowing()).toBe(false);
  });

  it('DIRECT top-level load, no BLOCK_INIT: renders the Open-on-Civitai fallback with the derived href', () => {
    setFrame('top-level');
    render(
      <BlockGate hostname="model-benchmarking.civit.ai">
        <Child />
      </BlockGate>,
    );
    // Within the grace period: children still render, no fallback yet.
    expect(screen.queryByTestId('app-content')).toBeTruthy();
    expect(fallbackShowing()).toBe(false);

    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });

    expect(screen.queryByTestId('app-content')).toBeNull();
    expect(fallbackShowing()).toBe(true);
    const link = screen.getByRole('link', { name: /open on civitai/i });
    expect(link.getAttribute('href')).toBe('https://civitai.com/apps/run/model-benchmarking');
  });

  it('derives the href from a different <slug>.civit.ai host', () => {
    setFrame('top-level');
    render(
      <BlockGate hostname="prompt-library.civit.ai">
        <Child />
      </BlockGate>,
    );
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });
    const link = screen.getByRole('link', { name: /open on civitai/i });
    expect(link.getAttribute('href')).toBe('https://civitai.com/apps/run/prompt-library');
  });

  it('TOP-LEVEL but BLOCK_INIT arrives first (dev harness): never shows the fallback', () => {
    setFrame('top-level');
    render(
      <BlockGate hostname="model-benchmarking.civit.ai">
        <Child />
      </BlockGate>,
    );
    act(() => {
      vi.advanceTimersByTime(10);
      dispatchInit();
    });
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1000);
    });
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(fallbackShowing()).toBe(false);
    expect(screen.queryByRole('link', { name: /open on civitai/i })).toBeNull();
  });

  it('NON-civit.ai top-level host (localhost): shows a neutral waiting state, NO broken apps/run link', () => {
    setFrame('top-level');
    render(
      <BlockGate hostname="localhost">
        <Child />
      </BlockGate>,
    );
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });
    expect(fallbackShowing()).toBe(true);
    expect(screen.getByText(/waiting for the civitai host/i)).toBeTruthy();
    // No redirect link at all — and definitely not a broken apps/run/localhost one.
    expect(screen.queryByRole('link', { name: /open on civitai/i })).toBeNull();
    expect(document.querySelector('[data-civitai-block-open-on-civitai]')).toBeNull();
    expect(document.body.innerHTML).not.toContain('apps/run/localhost');
  });

  it('honors a custom timeout on the gate', () => {
    setFrame('top-level');
    render(
      <BlockGate hostname="model-benchmarking.civit.ai" timeoutMs={500}>
        <Child />
      </BlockGate>,
    );
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(fallbackShowing()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fallbackShowing()).toBe(true);
  });

  it('renders a supplied custom fallback instead of the default landing', () => {
    setFrame('top-level');
    render(
      <BlockGate
        hostname="model-benchmarking.civit.ai"
        fallback={<div data-testid="custom-fallback">nope</div>}
      >
        <Child />
      </BlockGate>,
    );
    act(() => {
      vi.advanceTimersByTime(TIMEOUT + 1);
    });
    expect(screen.getByTestId('custom-fallback')).toBeTruthy();
    expect(fallbackShowing()).toBe(false); // the default landing is NOT used
  });

  describe('<DirectLoadFallback> (rendered directly)', () => {
    it('renders the Open-on-Civitai link for a civit.ai host', () => {
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      const link = screen.getByRole('link', { name: /open on civitai/i });
      expect(link.getAttribute('href')).toBe('https://civitai.com/apps/run/model-benchmarking');
      // Navigates the whole page, not a nested context.
      expect(link.getAttribute('target')).toBe('_top');
    });

    it('renders the neutral waiting state for a non-civit.ai host', () => {
      render(<DirectLoadFallback hostname="localhost" />);
      expect(screen.getByText(/waiting for the civitai host/i)).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
    });
  });

  /*
   * Styling used to arrive as a SIDE EFFECT of rendering a `/ui` component —
   * each one calls `useBlocksStyles()` itself. So a block that wraps its root in
   * <BlockGate> but renders none of them got the design-system CSS on the
   * direct-load fallback (which renders Card/Stack) and NOTHING on the happy
   * path. <Child> below is exactly that block: plain markup, no `/ui` import.
   *
   * These assert BOTH branches, because a guard on one is what let this through.
   */
  describe('design-system styles are injected on BOTH branches', () => {
    const MARKERS = [
      'style[data-civitai-theme]',
      'style[data-civitai-components]',
      'style[data-civitai-blocks-ui]',
    ];
    const injected = () => MARKERS.filter((s) => document.querySelector(s) != null);

    // The suite-level afterEach does not clear these, and injection is idempotent
    // per document — so without this a leaked <style> from an earlier test would
    // make every assertion below pass vacuously.
    beforeEach(() => {
      for (const sel of MARKERS) document.querySelectorAll(sel).forEach((el) => el.remove());
    });

    it('starts from a document with none of them (the assertions are not vacuous)', () => {
      expect(injected()).toEqual([]);
    });

    it('EMBEDDED happy path: a block rendering NO /ui component still gets all three', () => {
      setFrame('embedded');
      render(
        <BlockGate hostname="model-benchmarking.civit.ai">
          <Child />
        </BlockGate>,
      );
      // The child really did render, and really is plain markup.
      expect(screen.getByTestId('app-content')).toBeTruthy();
      expect(fallbackShowing()).toBe(false);
      expect(injected()).toEqual(MARKERS);
    });

    it('DIRECT-LOAD branch: still gets all three (no regression)', () => {
      setFrame('top-level');
      render(
        <BlockGate hostname="model-benchmarking.civit.ai">
          <Child />
        </BlockGate>,
      );
      act(() => {
        vi.advanceTimersByTime(TIMEOUT + 1000);
      });
      expect(fallbackShowing()).toBe(true);
      expect(injected()).toEqual(MARKERS);
    });

    it('a custom fallback that renders no /ui component is styled too', () => {
      setFrame('top-level');
      render(
        <BlockGate
          hostname="model-benchmarking.civit.ai"
          fallback={<div data-testid="custom-bare">bare</div>}
        >
          <Child />
        </BlockGate>,
      );
      act(() => {
        vi.advanceTimersByTime(TIMEOUT + 1000);
      });
      expect(screen.getByTestId('custom-bare')).toBeTruthy();
      expect(injected()).toEqual(MARKERS);
    });
  });
});
