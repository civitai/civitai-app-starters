import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockInitPayload } from '@civitai/app-sdk/blocks';

import { BlockGate, DirectLoadFallback } from '../src/ui/BlockGate.js';
import { getTransport } from '../src/transport/singleton.js';
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
   * The fallback card used to read `prefers-color-scheme`, so on a light-OS
   * machine it painted a LIGHT card on a deliberately DARK page. It now follows
   * the DOCUMENT (`data-theme` on `<html>`, which the scaffolded index.html sets
   * pre-paint from the host fragment) and defaults to dark.
   *
   * Every case below THAT RENDERS THE CARD sets the OS preference to the
   * OPPOSITE of the expected answer, so a fixture cannot pass by agreeing with
   * both rules at once — and each of those is red against the pre-change
   * component. `osColorSchemeQueries()` pins the stronger claim: the OS is never
   * ASKED, not merely overruled.
   *
   * The negative control — the case titled "the stub itself works …" — renders
   * nothing: it asserts the OS preference AGREES with what the stub was told to
   * report, and it passes against both the pre-change and post-change component.
   * Named rather than placed, so inserting a case above it cannot misidentify it.
   *
   * The opposite-OS and red-at-base claims describe the card-rendering cases as
   * they stand, NOT a promise about a case added later: a new rendering case
   * whose fixture agrees with the OS instead of opposing it falsifies both.
   * (The never-asked claim survives that — it does not depend on fixture
   * polarity.) If you add such a case, either make it conform or move those two
   * claims onto the cases that honour them.
   */
  describe('the fallback theme comes from the PAGE, never the OS', () => {
    /** Report `prefersDark` for the color-scheme query, recording every query asked. */
    function stubOsPreference(prefersDark: boolean) {
      const asked: string[] = [];
      const impl = ((query: string) => {
        asked.push(query);
        return {
          matches: /prefers-color-scheme:\s*dark/.test(query) ? prefersDark : false,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as unknown as MediaQueryList;
      }) as typeof window.matchMedia;
      vi.stubGlobal('matchMedia', impl);
      return () => asked.filter((q) => q.includes('prefers-color-scheme'));
    }

    /** The wrapper's own `data-theme` — the attribute that decides the card's tokens. */
    const cardTheme = () =>
      document.querySelector('[data-civitai-block-direct-load]')?.getAttribute('data-theme');

    function setPageTheme(value: string | null) {
      if (value == null) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
    }

    afterEach(() => {
      setPageTheme(null);
      vi.unstubAllGlobals();
    });

    it('page is LIGHT, OS says dark → light (the page wins, and the OS is never asked)', () => {
      const osColorSchemeQueries = stubOsPreference(true);
      setPageTheme('light');
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      expect(cardTheme()).toBe('light');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it('page is DARK, OS says light → dark', () => {
      const osColorSchemeQueries = stubOsPreference(false);
      setPageTheme('dark');
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      expect(cardTheme()).toBe('dark');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it('page carries NO data-theme, OS says light → dark (dark is the floor, not the OS)', () => {
      const osColorSchemeQueries = stubOsPreference(false);
      setPageTheme(null);
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      expect(cardTheme()).toBe('dark');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it("an unrecognised data-theme ('auto'), OS says light → dark: only 'light' buys light", () => {
      const osColorSchemeQueries = stubOsPreference(false);
      setPageTheme('auto');
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      expect(cardTheme()).toBe('dark');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it('an EMPTY data-theme, OS says light → dark', () => {
      const osColorSchemeQueries = stubOsPreference(false);
      setPageTheme('');
      render(<DirectLoadFallback hostname="model-benchmarking.civit.ai" />);
      expect(cardTheme()).toBe('dark');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it('through the gate: the direct-load branch carries the PAGE theme too', () => {
      const osColorSchemeQueries = stubOsPreference(false);
      setPageTheme('dark');
      setFrame('top-level');
      render(
        <BlockGate hostname="model-benchmarking.civit.ai">
          <Child />
        </BlockGate>,
      );
      act(() => {
        vi.advanceTimersByTime(TIMEOUT + 1);
      });
      expect(fallbackShowing()).toBe(true);
      expect(cardTheme()).toBe('dark');
      expect(osColorSchemeQueries()).toEqual([]);
    });

    it('the stub itself works — the negative control for every never-asked assertion above', () => {
      const osColorSchemeQueries = stubOsPreference(true);
      expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
      expect(window.matchMedia('(prefers-color-scheme: light)').matches).toBe(false);
      expect(osColorSchemeQueries()).toEqual([
        '(prefers-color-scheme: dark)',
        '(prefers-color-scheme: light)',
      ]);
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
