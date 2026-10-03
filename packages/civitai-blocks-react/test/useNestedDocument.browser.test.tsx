/**
 * REAL-BROWSER verification of `useNestedDocument` — the `srcdoc` fallback a
 * block needs because it cannot frame its own bundled content by URL.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS IN THE BROWSER TIER
 * ======================================================
 * The hook's job is to produce a string that a REAL HTML PARSER will treat as a
 * document whose relative URLs resolve against a base the hook injected. That
 * is a claim about URL resolution inside an iframe, and happy-dom does not
 * resolve `<base href>` the way a browser does — so a unit-tier assertion could
 * only re-state the string the implementation built, which is the one thing a
 * test must never do. Here the assertion is on `img.src` as the BROWSER
 * computed it, read out of a live `srcdoc` document.
 *
 * A `srcdoc` frame is also the only mechanism available at all:
 *
 *   - a block's own frame is sandboxed without `allow-same-origin`, so its
 *     origin is OPAQUE (`window.origin === "null"`);
 *   - every path on the static host carries `frame-ancestors` and
 *     `X-Frame-Options: SAMEORIGIN`, stamped at the platform edge;
 *   - an opaque ancestor matches NO `frame-ancestors` source list — measured,
 *     `*` included — so `<iframe src="…/game/index.html">` is blocked and no
 *     manifest change unblocks it.
 *
 * `srcdoc` inherits the embedder's origin and carries no response headers, so
 * neither policy applies. What it also inherits is the embedder's BASE URL
 * (`about:srcdoc`), which is why the `<base>` injection is load-bearing rather
 * than cosmetic.
 *
 * WHAT IS CHECKED
 * ===============
 *   1. The state machine: `idle` with no `src`, `loading` → `ready`,
 *      `loading` → `error`, and a `src` change restarting the cycle.
 *   2. Unmount aborts the in-flight fetch, and a response that lands afterwards
 *      writes no state and logs nothing.
 *   3. MECHANISM, in the browser: the produced string, mounted as `srcdoc`,
 *      makes a relative `<img src="sprite.png">` resolve against the injected
 *      base — WITH a negative control proving the same markup WITHOUT a base
 *      resolves somewhere else entirely.
 *
 * WHAT THIS TIER CANNOT SEE, MEASURED. Replacing `new URL('.', docUrl).href`
 * with `docUrl.href` in `injectBaseHref` — basing on the document rather than
 * its directory — SURVIVES every assertion here, because a `<base href>` naming
 * the document resolves a relative URL identically to one naming its directory.
 * That mutant is caught by the app-sdk unit suite's literal-string assertions
 * (14 red), which is the division of labour: those pin the exact bytes and the
 * reported `baseHref`, this file proves a real parser RESOLVES against them.
 * Deleting the insertion outright reddens 4 tests here, including the `img.src`
 * one, with the production symptom (`http://localhost:…/sprite.png`).
 *
 * FIXTURE VALUES ARE PAIRWISE DISTINCT. The host (`nested-fixture.example`),
 * the two directories (`engine/`, `other/`), the two documents (`boot.html`,
 * `view.html`) and the asset (`sprite.png`) share no substring, and none of
 * them is a substring of the test page's own origin — so an assertion cannot be
 * satisfied by the wrong one of them, and a mutant that drops the base resolves
 * against `localhost` and fails loudly.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNestedDocument } from '../src/hooks/useNestedDocument.js';

/* ------------------------------------------------------------------ fixtures */

const HOST = 'https://nested-fixture.example';
const BOOT = `${HOST}/engine/boot.html`;
const VIEW = `${HOST}/other/view.html`;

/** Carries a RELATIVE asset reference — the thing the `<base>` has to fix. */
const MARKUP = '<!doctype html><html><head></head><body><img src="sprite.png"></body></html>';

/** A deferred fetch, so `loading` is observable rather than a race. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function textResponse(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

/** Probe component: renders the hook's three fields as text. */
function Probe({ src, baseUrl }: { src?: string; baseUrl?: string }) {
  const { srcDoc, status, error } = useNestedDocument({ src, baseUrl });
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error ? error.message : '-'}</span>
      <span data-testid="len">{srcDoc === null ? 'null' : String(srcDoc.length)}</span>
      <span data-testid="doc">{srcDoc ?? ''}</span>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;

/* ----------------------------------------------------------------- plumbing */

interface Call {
  url: string;
  signal: AbortSignal | undefined;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelectorAll('iframe[data-nested-fixture]').forEach((el) => el.remove());
});

/** Stub `fetch`, recording every call, and answer from `handler`. */
function stubFetch(handler: (url: string) => Promise<Response>) {
  vi.stubGlobal('fetch', (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, signal: init?.signal ?? undefined });
    return handler(url);
  });
}

/* ------------------------------------------------------------ state machine */

describe('useNestedDocument — the state machine, in a real browser', () => {
  it('no src → idle, and nothing is fetched', () => {
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe />);

    expect(status()).toBe('idle');
    expect(screen.getByTestId('len').textContent).toBe('null');
    expect(screen.getByTestId('error').textContent).toBe('-');
    expect(calls).toHaveLength(0);
  });

  it('POSITIVE CONTROL: the same stub IS called once a src is given', async () => {
    // Without this, `calls` being empty above is indistinguishable from a stub
    // that was never wired to the hook.
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe src={BOOT} />);

    await waitFor(() => expect(status()).toBe('ready'));
    expect(calls.map((c) => c.url)).toEqual(['https://nested-fixture.example/engine/boot.html']);
  });

  it('mounting WITH a src starts at loading — never a one-tick idle flash', async () => {
    const d = deferred<Response>();
    stubFetch(() => d.promise);

    render(<Probe src={BOOT} />);
    // Synchronous read on the very first render.
    expect(status()).toBe('loading');
    expect(screen.getByTestId('len').textContent).toBe('null');

    d.resolve(textResponse(200, MARKUP));
    await waitFor(() => expect(status()).toBe('ready'));
  });

  it('loading → ready exposes a srcDoc, and error stays null', async () => {
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe src={BOOT} />);

    await waitFor(() => expect(status()).toBe('ready'));
    expect(screen.getByTestId('error').textContent).toBe('-');
    expect(screen.getByTestId('doc').textContent).toBe(
      '<!doctype html><html><head><base href="https://nested-fixture.example/engine/"></head>' +
        '<body><img src="sprite.png"></body></html>',
    );
  });

  it('loading → error on a non-OK status, with the status in the message', async () => {
    stubFetch(async () => textResponse(503, 'unavailable'));
    render(<Probe src={BOOT} />);

    await waitFor(() => expect(status()).toBe('error'));
    expect(screen.getByTestId('error').textContent).toBe(
      'fetchNestedDocument: https://nested-fixture.example/engine/boot.html returned HTTP 503.',
    );
    expect(screen.getByTestId('len').textContent).toBe('null');
  });

  it('loading → error on a rejected fetch', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<Probe src={BOOT} />);

    await waitFor(() => expect(status()).toBe('error'));
    expect(screen.getByTestId('len').textContent).toBe('null');
  });

  it('changing src restarts the cycle and aborts the first fetch', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    stubFetch((url) => (url.includes('boot.html') ? first.promise : second.promise));

    const { rerender } = render(<Probe src={BOOT} />);
    expect(status()).toBe('loading');

    rerender(<Probe src={VIEW} />);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(false);
    expect(calls[1]?.url).toBe('https://nested-fixture.example/other/view.html');

    // The superseded fetch resolving LATE must not win.
    first.resolve(textResponse(200, '<head></head><!-- first -->'));
    second.resolve(textResponse(200, MARKUP));

    await waitFor(() => expect(status()).toBe('ready'));
    expect(screen.getByTestId('doc').textContent).toBe(
      '<!doctype html><html><head><base href="https://nested-fixture.example/other/"></head>' +
        '<body><img src="sprite.png"></body></html>',
    );
  });

  it('clearing src returns the hook to idle', async () => {
    stubFetch(async () => textResponse(200, MARKUP));
    const { rerender } = render(<Probe src={BOOT} />);
    await waitFor(() => expect(status()).toBe('ready'));

    rerender(<Probe />);
    expect(status()).toBe('idle');
    expect(screen.getByTestId('len').textContent).toBe('null');
  });

  it('a relative src resolves against baseUrl', async () => {
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe src="boot.html" baseUrl={`${HOST}/engine/`} />);

    await waitFor(() => expect(status()).toBe('ready'));
    expect(calls[0]?.url).toBe('https://nested-fixture.example/engine/boot.html');
  });
});

describe('useNestedDocument — unmount', () => {
  it('aborts the in-flight fetch, and a late response writes nothing and logs nothing', async () => {
    const d = deferred<Response>();
    stubFetch(() => d.promise);
    const errors: unknown[][] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });

    const { unmount } = render(<Probe src={BOOT} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    // POSITIVE CONTROL for the abort assertion: not aborted while mounted, so
    // `aborted === true` below is a consequence of unmounting and not a
    // constant.
    expect(calls[0]?.signal?.aborted).toBe(false);

    unmount();
    expect(calls[0]?.signal?.aborted).toBe(true);

    d.resolve(textResponse(200, MARKUP));
    await d.promise;
    // One more macrotask so the hook's `.then` would have run by now.
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toEqual([]);
    expect(screen.queryByTestId('status')).toBeNull();
  });
});

/* -------------------------------------------------- the mechanism, in-browser */

describe('the injected <base> is what makes relative assets resolve', () => {
  /** Mount `srcdoc` in a same-origin iframe and read the browser's own resolution. */
  async function resolvedImgSrc(srcDoc: string): Promise<string> {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-nested-fixture', '');
    const loaded = new Promise<void>((resolve) => {
      iframe.addEventListener('load', () => resolve(), { once: true });
    });
    iframe.srcdoc = srcDoc;
    document.body.appendChild(iframe);
    await loaded;
    const img = iframe.contentDocument?.querySelector('img');
    if (!img) throw new Error('fixture iframe has no <img> — the srcdoc did not parse');
    return img.src;
  }

  it('🔴 a relative <img src> resolves against the injected base', async () => {
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe src={BOOT} />);
    await waitFor(() => expect(status()).toBe('ready'));

    const srcDoc = screen.getByTestId('doc').textContent ?? '';
    expect(await resolvedImgSrc(srcDoc)).toBe(
      'https://nested-fixture.example/engine/sprite.png',
    );
  });

  it('NEGATIVE CONTROL: the same markup WITHOUT a base resolves to the embedder instead', async () => {
    // This is the failure the hook exists to prevent, and the proof that the
    // assertion above is reading a real resolution rather than a string match:
    // with no `<base>`, the browser resolves against the test page's own origin,
    // which shares no substring with the fixture host.
    const resolved = await resolvedImgSrc(MARKUP);
    expect(resolved).not.toContain('nested-fixture.example');
    expect(resolved).toBe(new URL('sprite.png', document.baseURI).href);
  });

  it('a nested directory in the src moves the base with it', async () => {
    stubFetch(async () => textResponse(200, MARKUP));
    render(<Probe src={`${HOST}/engine/deep/inner.html`} />);
    await waitFor(() => expect(status()).toBe('ready'));

    const srcDoc = screen.getByTestId('doc').textContent ?? '';
    expect(await resolvedImgSrc(srcDoc)).toBe(
      'https://nested-fixture.example/engine/deep/sprite.png',
    );
  });
});
