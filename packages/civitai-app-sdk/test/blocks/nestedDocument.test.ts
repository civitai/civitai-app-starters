/**
 * Unit coverage for `@civitai/app-sdk/blocks`'s nested-document helper — the
 * `srcdoc` pattern that is the ONLY way a block can embed one of its own
 * bundled documents.
 *
 * WHY THIS EXISTS
 * ===============
 * A block's own frame is sandboxed without `allow-same-origin`, so its origin
 * is opaque; the static host stamps `frame-ancestors` + `X-Frame-Options` on
 * every path it serves. Measured in a two-origin Chromium replica, an opaque
 * ancestor matches NO `frame-ancestors` source list — `*` included — so a
 * nested `<iframe src="https://<slug>.civit.ai/game/index.html">` is blocked
 * and no manifest change can unblock it. `fetchNestedDocument` fetches the
 * markup instead (the host sends `Access-Control-Allow-Origin: *`) and rewrites
 * its base URL so it still works from a `srcdoc` frame, which carries no
 * response headers and inherits the parent's origin.
 *
 * THE `<base href>` IS THE WHOLE MECHANISM, AND IT FAILS SILENTLY
 * ==============================================================
 * A `srcdoc` document's base URL is `about:srcdoc`, inheriting the embedder's —
 * an opaque origin. Every relative `src=` in the fetched markup then resolves
 * to nothing, and nothing in the error message says "base URL": the author sees
 * a pile of failed asset loads. So the base href is asserted as a LITERAL
 * STRING everywhere below, never recomputed from the implementation.
 *
 * WATCHED TO FAIL (mutation-checked, 2026-10-03), five mutants, each killed by
 * the assertion written for it:
 *
 *   - delete the `<base>` insertion → 10 red.
 *   - base on the document instead of its directory (`docUrl.href` for
 *     `new URL('.', docUrl).href`) → 14 red, first with
 *     `expected '<base href="…/engine/boot.html">' to be
 *      '<base href="…/engine/">'`.
 *   - stop replacing an existing `<base href>`, inserting alongside it → 4 red,
 *     including the `<base` occurrence count.
 *   - drop the `\b` after `<head` in `HEAD_OPEN` → 1 red, the `<header>` test,
 *     with the base landing INSIDE `<header>` (after the asset references,
 *     where it does nothing).
 *   - drop the `\b` after `<base` in `EXISTING_BASE_HREF` → 1 red, the same
 *     test, `<basefont href>` having been read as the document's base.
 *
 * 🔴 THE SECOND MUTANT IS WHY THIS FILE'S LITERAL STRINGS ARE LOAD-BEARING, AND
 * WHY ITS BROWSER SIBLING DOES NOT DUPLICATE THEM. A `<base href>` naming the
 * document resolves a relative URL IDENTICALLY to one naming its directory, so
 * that mutant is behaviourally equivalent for asset loading and the browser
 * tier's `img.src` assertion SURVIVES it — measured, not assumed. The directory
 * form is kept because it is what a caller is handed as `baseHref`, and only a
 * literal-string assertion can see it. Division of labour:
 *   this file                          → the exact bytes, `baseHref` included
 *   `useNestedDocument.browser.test`   → that a real parser RESOLVES against it
 *
 * FIXTURE VALUES ARE PAIRWISE DISTINCT, ON PURPOSE. The host
 * (`blocks-fixture.example`), the directory (`engine/`), the document
 * (`boot.html`), the asset (`loader.mjs`) and the already-declared base
 * (`/pkg/`) share no substring, so a mutant that hardcodes any one of them
 * cannot satisfy an assertion naming another. No assertion's expected value is
 * derivable from any other fixture field.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NestedDocumentError,
  fetchNestedDocument,
  injectBaseHref,
} from '../../src/blocks/nestedDocument.js';

/* ------------------------------------------------------------------ fixtures */

const HOST = 'https://blocks-fixture.example';
const DOC_URL = `${HOST}/engine/boot.html`;

/** A document with a `<head>` and a relative asset — the ordinary case. */
const DOC_WITH_HEAD =
  '<!doctype html><html><head><title>Engine</title></head>' +
  '<body><script type="module" src="loader.mjs"></script></body></html>';

/* ------------------------------------------------------- fetch stub plumbing */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  // 🔴 `restoreAllMocks` does NOT undo `stubGlobal`. Without this line the
  // `document`/`location` stubs below leak into later tests and the
  // "no document base" case resolves instead of rejecting — i.e. the suite
  // would pass or fail on FILE ORDER. Measured while writing it.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Minimal `Response` stand-in — the three members the helper reads. */
function textResponse(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

/* --------------------------------------------------------- injectBaseHref() */

describe('injectBaseHref — the base is absolute, and it is the document DIRECTORY', () => {
  it('injects the directory of the document URL, after the opening <head>', () => {
    const result = injectBaseHref(DOC_WITH_HEAD, DOC_URL);

    // Literal, and the whole document — not a substring match, so an insertion
    // at the wrong place fails here too.
    expect(result.html).toBe(
      '<!doctype html><html><head><base href="https://blocks-fixture.example/engine/">' +
        '<title>Engine</title></head>' +
        '<body><script type="module" src="loader.mjs"></script></body></html>',
    );
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(result.hadExistingBase).toBe(false);
  });

  it('the <base> precedes every asset reference in the output', () => {
    // The ORDERING property, stated independently of the exact string above:
    // a base that lands after a `src=` does not apply to it.
    const { html } = injectBaseHref(DOC_WITH_HEAD, DOC_URL);
    expect(html.indexOf('<base ')).toBeGreaterThan(-1);
    expect(html.indexOf('<base ')).toBeLessThan(html.indexOf('src="loader.mjs"'));
  });

  it('a document at the host root bases on "/"', () => {
    const { baseHref } = injectBaseHref('<head></head>', `${HOST}/index.html`);
    expect(baseHref).toBe('https://blocks-fixture.example/');
  });

  it('a query string and fragment on the document URL are dropped from the base', () => {
    const { baseHref } = injectBaseHref(
      '<head></head>',
      `${HOST}/engine/boot.html?v=7#start`,
    );
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
  });

  it('a <head> with attributes is still the insertion point', () => {
    const { html } = injectBaseHref('<head data-x="1"><meta charset="utf-8">', DOC_URL);
    expect(html).toBe(
      '<head data-x="1"><base href="https://blocks-fixture.example/engine/">' +
        '<meta charset="utf-8">',
    );
  });

  it('HEAD and BASE are matched case-insensitively', () => {
    const { html, hadExistingBase } = injectBaseHref('<HEAD><TITLE>t</TITLE>', DOC_URL);
    expect(html).toBe(
      '<HEAD><base href="https://blocks-fixture.example/engine/"><TITLE>t</TITLE>',
    );
    expect(hadExistingBase).toBe(false);
  });
});

describe('injectBaseHref — a document that already declares a <base>', () => {
  it('REPLACES it, resolved against the document URL (one <base> in the output)', () => {
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<!doctype html><head><base href="/pkg/"><title>Engine</title></head>',
      DOC_URL,
    );

    expect(baseHref).toBe('https://blocks-fixture.example/pkg/');
    expect(hadExistingBase).toBe(true);
    expect(html).toBe(
      '<!doctype html><head><base href="https://blocks-fixture.example/pkg/">' +
        '<title>Engine</title></head>',
    );
    // Not double-injected. The count is the half a substring assertion misses:
    // a second <base> would be ignored by the parser and silently keep the
    // relative href as the effective one.
    expect(html.match(/<base\b/gi)?.length).toBe(1);
  });

  it('a single-quoted and an unquoted href are both read', () => {
    expect(injectBaseHref("<head><base href='/pkg/'>", DOC_URL).baseHref).toBe(
      'https://blocks-fixture.example/pkg/',
    );
    expect(injectBaseHref('<head><base href=/pkg/>', DOC_URL).baseHref).toBe(
      'https://blocks-fixture.example/pkg/',
    );
  });

  it('an already-absolute <base href> on another host is kept as-is', () => {
    const { baseHref, hadExistingBase } = injectBaseHref(
      '<head><base href="https://cdn-fixture.example/pkg/">',
      DOC_URL,
    );
    expect(baseHref).toBe('https://cdn-fixture.example/pkg/');
    expect(hadExistingBase).toBe(true);
  });

  it('attributes around href survive the rewrite only as the new tag', () => {
    const { html } = injectBaseHref('<head><base target="_top" href="/pkg/">', DOC_URL);
    // The replacement is the WHOLE tag, so `target` is dropped. Stated as a
    // literal because it is a behaviour a caller can be surprised by, not an
    // accident: a `target` that survived would retarget every link in the
    // nested document, which is not something this helper should carry over
    // silently.
    expect(html).toBe('<head><base href="https://blocks-fixture.example/pkg/">');
  });

  it('a <base target> with NO href sets no base URL, so it is left alone', () => {
    const { html, hadExistingBase } = injectBaseHref('<head><base target="_top">', DOC_URL);
    expect(hadExistingBase).toBe(false);
    expect(html).toBe(
      '<head><base href="https://blocks-fixture.example/engine/"><base target="_top">',
    );
  });

  it('an empty href is treated as absent (it sets no base URL either)', () => {
    const { baseHref, hadExistingBase } = injectBaseHref('<head><base href="">', DOC_URL);
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(hadExistingBase).toBe(false);
  });
});

describe('injectBaseHref — a document with no <head>', () => {
  it('inserts after a leading doctype', () => {
    const { html } = injectBaseHref('<!doctype html><body><canvas></canvas>', DOC_URL);
    expect(html).toBe(
      '<!doctype html><base href="https://blocks-fixture.example/engine/">' +
        '<body><canvas></canvas>',
    );
  });

  it('inserts at the very start when there is no doctype either', () => {
    const { html } = injectBaseHref('<canvas id="c"></canvas>', DOC_URL);
    expect(html).toBe(
      '<base href="https://blocks-fixture.example/engine/"><canvas id="c"></canvas>',
    );
  });

  it('an empty document still comes back with a base', () => {
    const { html } = injectBaseHref('', DOC_URL);
    expect(html).toBe('<base href="https://blocks-fixture.example/engine/">');
  });

  it('🔴 <header> is NOT mistaken for <head>, and nor is <basefont>', () => {
    // Both are real tags an ordinary document carries, and both are a prefix of
    // the tag this module looks for. A regex without the `\b` would insert the
    // base INSIDE `<header>` (after the asset references, where it does
    // nothing) or rewrite a `<basefont href>` as the document's base.
    const { html, hadExistingBase } = injectBaseHref(
      '<body><header><basefont href="/pkg/"><img src="sprite.png"></header>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(false);
    expect(html).toBe(
      '<base href="https://blocks-fixture.example/engine/">' +
        '<body><header><basefont href="/pkg/"><img src="sprite.png"></header>',
    );
  });
});

describe('injectBaseHref — bad input', () => {
  it('a relative documentUrl is an invalid-url NestedDocumentError', () => {
    let thrown: unknown;
    try {
      injectBaseHref(DOC_WITH_HEAD, '/engine/boot.html');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NestedDocumentError);
    expect((thrown as NestedDocumentError).code).toBe('invalid-url');
    expect((thrown as NestedDocumentError).name).toBe('NestedDocumentError');
    expect((thrown as NestedDocumentError).message).toBe(
      'injectBaseHref: documentUrl is not an absolute URL: /engine/boot.html',
    );
  });

  it("POSITIVE CONTROL: the same call with an ABSOLUTE documentUrl does not throw", () => {
    // Without this, the test above is satisfied by an implementation that
    // throws on every input.
    expect(() => injectBaseHref(DOC_WITH_HEAD, DOC_URL)).not.toThrow();
  });
});

/* ---------------------------------------------------- fetchNestedDocument() */

describe('fetchNestedDocument — the happy path', () => {
  it('fetches the absolute src and returns a srcDoc with the injected base', async () => {
    const mock = stubFetch(async () => textResponse(200, DOC_WITH_HEAD));

    const result = await fetchNestedDocument({ src: DOC_URL });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toBe('https://blocks-fixture.example/engine/boot.html');
    expect(result.url).toBe('https://blocks-fixture.example/engine/boot.html');
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(result.hadExistingBase).toBe(false);
    expect(result.srcDoc).toBe(
      '<!doctype html><html><head><base href="https://blocks-fixture.example/engine/">' +
        '<title>Engine</title></head>' +
        '<body><script type="module" src="loader.mjs"></script></body></html>',
    );
  });

  it('reports hadExistingBase when the fetched document declared one', async () => {
    stubFetch(async () => textResponse(200, '<head><base href="/pkg/">'));
    const result = await fetchNestedDocument({ src: DOC_URL });
    expect(result.hadExistingBase).toBe(true);
    expect(result.baseHref).toBe('https://blocks-fixture.example/pkg/');
  });

  it('it does NOT sanitize: scripts and inline handlers come back verbatim', async () => {
    // A documented decision, pinned so it cannot be "hardened" into a silent
    // behaviour change. The nested document is the app's OWN bundle; stripping
    // its scripts would remove the thing it exists to run.
    const hostile = '<head></head><body onload="go()"><script>globalThis.x=1</script>';
    stubFetch(async () => textResponse(200, hostile));
    const { srcDoc } = await fetchNestedDocument({ src: DOC_URL });
    expect(srcDoc).toBe(
      '<head><base href="https://blocks-fixture.example/engine/"></head>' +
        '<body onload="go()"><script>globalThis.x=1</script>',
    );
  });
});

describe('fetchNestedDocument — resolving a relative src', () => {
  it('resolves against an explicit baseUrl', async () => {
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));

    const result = await fetchNestedDocument({
      src: 'boot.html',
      baseUrl: `${HOST}/engine/`,
    });

    expect(mock.mock.calls[0]?.[0]).toBe('https://blocks-fixture.example/engine/boot.html');
    expect(result.url).toBe('https://blocks-fixture.example/engine/boot.html');
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/');
  });

  it("resolves against the current document's baseURI when no baseUrl is given", async () => {
    // The node environment has no `document`; stub one so this branch is
    // reachable at all. `document.baseURI` is the reading the helper takes.
    vi.stubGlobal('document', { baseURI: `${HOST}/engine/boot.html` });
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));

    const result = await fetchNestedDocument({ src: 'nested/view.html' });

    expect(mock.mock.calls[0]?.[0]).toBe(
      'https://blocks-fixture.example/engine/nested/view.html',
    );
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/nested/');
  });

  it('falls back to location.href when there is no document', async () => {
    vi.stubGlobal('location', { href: `${HOST}/engine/boot.html` });
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));

    await fetchNestedDocument({ src: 'view.html' });

    expect(mock.mock.calls[0]?.[0]).toBe('https://blocks-fixture.example/engine/view.html');
  });

  it('a relative src with NO document base is an invalid-url error, and names why', async () => {
    // Node, a worker, SSR. No fetch is attempted.
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));

    await expect(fetchNestedDocument({ src: 'boot.html' })).rejects.toThrow(
      'fetchNestedDocument: cannot resolve src "boot.html" — it is relative and this runtime ' +
        'has no document base URL. Pass an absolute src, or options.baseUrl.',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: the same stub DOES get called for an absolute src', async () => {
    // The `not.toHaveBeenCalled()` above is otherwise indistinguishable from a
    // stub that was never wired to the helper at all.
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));
    await fetchNestedDocument({ src: DOC_URL });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('an unresolvable src against a given base is an invalid-url error', async () => {
    let thrown: unknown;
    try {
      await fetchNestedDocument({ src: 'boot.html', baseUrl: 'not a url' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NestedDocumentError);
    expect((thrown as NestedDocumentError).code).toBe('invalid-url');
    expect((thrown as NestedDocumentError).message).toBe(
      'fetchNestedDocument: cannot resolve src "boot.html" against base "not a url".',
    );
  });
});

describe('fetchNestedDocument — failures', () => {
  it('a non-OK status is an http-error carrying the status', async () => {
    stubFetch(async () => textResponse(404, 'nope'));

    let thrown: unknown;
    try {
      await fetchNestedDocument({ src: DOC_URL });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NestedDocumentError);
    expect((thrown as NestedDocumentError).code).toBe('http-error');
    expect((thrown as NestedDocumentError).status).toBe(404);
    expect((thrown as NestedDocumentError).url).toBe(
      'https://blocks-fixture.example/engine/boot.html',
    );
    expect((thrown as NestedDocumentError).message).toBe(
      'fetchNestedDocument: https://blocks-fixture.example/engine/boot.html returned HTTP 404.',
    );
  });

  it('a 500 is reported with ITS status, not 404', async () => {
    // Pins that `.status` is read off the response rather than hardcoded —
    // which a single-status test cannot see.
    stubFetch(async () => textResponse(500, ''));
    await expect(fetchNestedDocument({ src: DOC_URL })).rejects.toMatchObject({
      code: 'http-error',
      status: 500,
    });
  });

  it('a rejected fetch (offline / CORS) is a network-error naming the CORS requirement', async () => {
    const cause = new TypeError('Failed to fetch');
    stubFetch(async () => {
      throw cause;
    });

    let thrown: unknown;
    try {
      await fetchNestedDocument({ src: DOC_URL });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(NestedDocumentError);
    expect((thrown as NestedDocumentError).code).toBe('network-error');
    expect((thrown as NestedDocumentError).cause).toBe(cause);
    expect((thrown as NestedDocumentError).message).toBe(
      'fetchNestedDocument: request to https://blocks-fixture.example/engine/boot.html failed. ' +
        'A block runs at an opaque origin, so the host must answer with ' +
        'Access-Control-Allow-Origin.',
    );
  });

  it('a body read that fails is a network-error', async () => {
    const cause = new Error('stream closed');
    stubFetch(
      async () =>
        ({
          ok: true,
          status: 200,
          text: async () => {
            throw cause;
          },
        }) as unknown as Response,
    );

    await expect(fetchNestedDocument({ src: DOC_URL })).rejects.toMatchObject({
      code: 'network-error',
      cause,
    });
  });

  it('an abort rejects with the platform AbortError, NOT a NestedDocumentError', async () => {
    // So `signal.aborted` keeps meaning "the caller cancelled" and a React
    // effect's cleanup does not have to parse an error code to tell a
    // cancellation from a failure.
    const controller = new AbortController();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    stubFetch(async (_url, init) => {
      controller.abort();
      void init;
      throw abortError;
    });

    let thrown: unknown;
    try {
      await fetchNestedDocument({ src: DOC_URL, signal: controller.signal });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBe(abortError);
    expect(thrown).not.toBeInstanceOf(NestedDocumentError);
  });

  it('the signal is forwarded to fetch', async () => {
    const controller = new AbortController();
    const mock = stubFetch(async () => textResponse(200, '<head></head>'));

    await fetchNestedDocument({ src: DOC_URL, signal: controller.signal });

    expect(mock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it('no global fetch is a network-error that says so', async () => {
    // @ts-expect-error — deliberately removing the global to reach the branch.
    delete globalThis.fetch;

    await expect(fetchNestedDocument({ src: DOC_URL })).rejects.toThrow(
      'fetchNestedDocument: this runtime has no global fetch.',
    );
  });
});
