/**
 * Unit coverage for `@civitai/app-sdk/blocks`'s nested-document helper — the
 * `srcdoc` pattern that is the ONLY way a block can embed one of its own
 * bundled documents.
 *
 * WHY THIS EXISTS
 * ===============
 * A nested `<iframe src="https://<slug>.civit.ai/game/index.html">` is blocked
 * and no manifest change can unblock it, so `fetchNestedDocument` fetches the
 * markup and rewrites its base URL for a `srcdoc` frame instead. The
 * derivation, the dated external platform matrix (which no test here or
 * anywhere in this repo exercises) and the known limits are in the header of
 * `../../src/blocks/nestedDocument.ts` and NOT restated here.
 *
 * THE `<base href>` IS THE WHOLE MECHANISM, AND IT FAILS SILENTLY
 * ==============================================================
 * A `srcdoc` document's base URL is `about:srcdoc`, inheriting the embedder's —
 * an opaque origin. Every relative `src=` in the fetched markup then resolves
 * to nothing, and nothing in the error message says "base URL": the author sees
 * a pile of failed asset loads. So the base href is asserted as a LITERAL
 * STRING everywhere below, never recomputed from the implementation.
 *
 * WATCHED TO FAIL (mutation-checked 2026-10-03, against the SINGLE-PASS SCANNER
 * — every count below was re-measured from scratch for it; the counts recorded
 * here for the two-regex implementation it replaced described code that no
 * longer exists). Denominator: this file, 51 tests green at HEAD. Where a
 * browser-tier number is given it is out of 15, from
 * `../../../civitai-blocks-react/test/useNestedDocument.browser.test.tsx`.
 *
 *   - delete the `<base>` insertion (`return { html, … }` for
 *     `insertInto(html, tag, scan)`)                 → 19 red, +5 of 15 browser.
 *   - base on the document instead of its directory (`docUrl.href` for
 *     `new URL('.', docUrl).href`)                   → 26 red, +2 of 15 browser,
 *     first with `expected '<base href="…/engine/boot.html">' to be
 *     '<base href="…/engine/">'`.
 *   - stop replacing an existing `<base href>` → KILLED IN EVERY FAITHFUL
 *     SPELLING, but the count DEPENDS ON THE SPELLING, so no single number is
 *     this mutant's count. Three spellings:
 *       - insert alongside, immediately after `<head>`, still resolving the
 *         existing href                                        →  6 red;
 *       - `scanDocument` reports no base at all (`undefined`)   → 10 red;
 *       - detect the tag but ignore its href, inserting alongside →  6 red.
 *     TWO assertions are red in ALL THREE — `REPLACES it … (one <base> in the
 *     output)` and `🔴 TWO <base href> tags …`, both of which count `<base`
 *     occurrences — and that is what makes the guard sound rather than any one
 *     of the numbers. (A pre-scanner draft of this list recorded a flat
 *     "4 red", which reproduced under none of the three spellings. The counts
 *     above are this implementation's and will move again if it changes.)
 *   - stop skipping HTML COMMENTS (`if (false)` for the `<!--` branch) → 2 red,
 *     both of them the two `REACHES THE COMMENT BRANCH` cases.
 *     🔴 AND THAT PAIR EXISTS BECAUSE THIS MUTANT SURVIVED THE FIRST SWEEP. The
 *     two plainer commented-`<base>`/`<head>` tests CANNOT see it: with the
 *     comment skip gone, the markup-declaration branch (`<!…>`) still swallows
 *     the comment, because it ends at the first `>` and those fixtures have
 *     none before the decoy. The guard was unreachable and scored a false
 *     green; a `>` early in the comment is what reaches it.
 *   - stop skipping `<script>`/`<style>` bodies (empty `RAW_TEXT_ELEMENTS`)
 *     → 2 red, +1 of 15 browser — the browser one being the only assertion
 *     anywhere that the inline script still RUNS.
 *   - drop tag-name case-insensitivity (no `.toLowerCase()` on the name)
 *     → 2 red, the two uppercase/mixed-case cases.
 *   - match the tag name as a PREFIX rather than whole (`name.startsWith(…)`,
 *     the scanner's equivalent of dropping a `\b`) → 1 red each for `head`
 *     (base lands inside `<header>`) and `base` (`<basefont href>` read as the
 *     document's base) — the same single test, `<header>`/`<basefont>`.
 *   - mis-handle the QUOTED-ATTRIBUTE state → also SPELLING-DEPENDENT, because
 *     the state has two characters in it: honouring only `'`
 *     (`if (quote === "'")`) → 10 red; honouring only `"` → 2 red. Each
 *     spelling is blind to the other quote character, which is why both
 *     a double- and a single-quoted `>` fixture are present.
 *   - ignore the response's FINAL url (`documentUrl = url`) → 2 red, the two
 *     redirect cases.
 *   - reinstate the QUADRATIC regex existing-base walk (`html.matchAll(
 *     /<base\b[^>]*>/gi)`) → 6 red, including the pathological-input timing
 *     guard with its own message: `expected 2722.071061 to be less than 500`,
 *     while the 576 KB BENIGN control stayed green (10-15 ms over four runs).
 *     That pair is the attribution: the input's SHAPE, not a slow machine.
 *
 * Method: exact-literal replacement with the occurrence count asserted to be 1,
 * restoring the module from a `cp -a` copy and re-checking its sha256 after
 * every restore, so a failed restore cannot score a borrowed kill for the next
 * mutant. One unmutated baseline run per pass as the positive control proving
 * the mutants executed (51/51, 7/7, 15/15 green).
 *
 * 🔴 THE DIRECTORY-VS-DOCUMENT MUTANT IS WHY THIS FILE'S LITERAL STRINGS ARE
 * LOAD-BEARING, AND WHY ITS BROWSER SIBLING DOES NOT DUPLICATE THEM. A
 * `<base href>` naming the document resolves a relative URL IDENTICALLY to one
 * naming its directory, so that mutant is behaviourally equivalent for asset
 * loading and every in-browser `img.src` assertion SURVIVES it — measured, not
 * assumed; the 2 browser reds are both whole-`srcDoc`-string assertions. The
 * directory form is kept because it is what a caller is handed as `baseHref`,
 * and only a literal-string assertion can see it. Division of labour:
 *   this file                          → the exact bytes, `baseHref` included
 *   `useNestedDocument.browser.test`   → that a real parser RESOLVES against it
 *   `useNestedDocument.test.tsx`       → the hook's deadline + its state pairing
 *
 * FIXTURE VALUES ARE PAIRWISE DISTINCT, ON PURPOSE. The host
 * (`blocks-fixture.example`), the directory (`engine/`), the document
 * (`boot.html`), the asset (`loader.mjs`), the already-declared base (`/pkg/`)
 * and every decoy below (`/commented/`, `/scripted/`, `/styled/`,
 * `/after-script/`, `/quoted/`, `/shouted/`, `/murmured/`, `/winner/`,
 * `/loser/`, `/second-wins/`, `arcade/`, `cdn/v9/`) share no substring, so a
 * mutant that hardcodes any one of them cannot satisfy an assertion naming
 * another. No assertion's expected value is derivable from any other fixture
 * field.
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

/**
 * Minimal `Response` stand-in — the four members the helper reads.
 *
 * 🔴 `url` IS REQUIRED HERE, AND THAT IS THE WHOLE POINT. The first revision of
 * this stub omitted it, and that omission is why NEITHER TIER could see that
 * the helper based the document on the REQUESTED url rather than the response's
 * FINAL one: with no `url` on the stub the two can never disagree, so a
 * redirect — the only case where they differ — was structurally invisible.
 * Every call site below passes the url the stub was actually asked for;
 * `redirectedResponse` passes a different one on purpose.
 */
function textResponse(status: number, body: string, url: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    text: async () => body,
  } as unknown as Response;
}

/** A `Response` whose final URL differs from the requested one — a redirect. */
function redirectedResponse(body: string, finalUrl: string): Response {
  return { ok: true, status: 200, url: finalUrl, text: async () => body } as unknown as Response;
}

/** A `Response` stand-in with NO `url` at all — the fallback branch. */
function urllessResponse(body: string): Response {
  return { ok: true, status: 200, text: async () => body } as unknown as Response;
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

describe('injectBaseHref — only REAL MARKUP counts', () => {
  // These are the cases the regex revision got wrong, and three of them it got
  // wrong in the harmful direction: detection turned a working document into a
  // broken one. Each expectation is the whole output document, as a literal.

  it('🔴 a <base href> inside an HTML COMMENT is not the document base', () => {
    // The regex found it and spliced the replacement INSIDE the comment, which
    // left the document with ZERO base elements — strictly worse than ignoring
    // it, because ignoring it inserts after `<head>` and works.
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<!doctype html><head><!-- <base href="/commented/"> --><title>t</title></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(false);
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(html).toBe(
      '<!doctype html><head><base href="https://blocks-fixture.example/engine/">' +
        '<!-- <base href="/commented/"> --><title>t</title></head>',
    );
  });

  it('🔴 REACHES THE COMMENT BRANCH: a ">" earlier in the comment does not expose the <base>', () => {
    // 🔴 THIS CASE EXISTS BECAUSE THE MUTATION SWEEP FOUND THE TEST ABOVE
    // CANNOT SEE THE COMMENT BRANCH AT ALL. Deleting the `<!--` skip leaves the
    // markup-declaration branch (`<!…>`), which ends at the FIRST `>` — and in
    // a comment with no earlier `>` that happens to swallow the whole thing, so
    // the guard's own assertion was satisfied by a different mechanism and the
    // mutant SURVIVED. Put a `>` before the decoy and only the comment branch
    // can hide it: without the skip, the declaration ends at `7 >` and
    // `<base href="/commented/">` is read as the document's base.
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<!doctype html><head><!-- 7 > 3, so <base href="/commented/"> is a decoy -->' +
        '<title>t</title></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(false);
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(html).toBe(
      '<!doctype html><head><base href="https://blocks-fixture.example/engine/">' +
        '<!-- 7 > 3, so <base href="/commented/"> is a decoy --><title>t</title></head>',
    );
  });

  it('🔴 REACHES THE COMMENT BRANCH: a commented <head> behind a ">" is not the insertion point', () => {
    // Same reaching argument as above, for the insertion side.
    const { html } = injectBaseHref(
      '<!doctype html><!-- 9 > 4, so <head> is a decoy --><body><canvas id="c"></canvas>',
      DOC_URL,
    );
    expect(html).toBe(
      '<!doctype html><base href="https://blocks-fixture.example/engine/">' +
        '<!-- 9 > 4, so <head> is a decoy --><body><canvas id="c"></canvas>',
    );
  });

  it('🔴 a <head> that appears only inside a comment is not the insertion point', () => {
    // Insertion falls back to "after the leading doctype", which IS parsed into
    // the head. The regex put it inside the comment, where it does nothing.
    const { html } = injectBaseHref(
      '<!doctype html><!-- <head> --><body><canvas id="c"></canvas>',
      DOC_URL,
    );
    expect(html).toBe(
      '<!doctype html><base href="https://blocks-fixture.example/engine/">' +
        '<!-- <head> --><body><canvas id="c"></canvas>',
    );
  });

  it('🔴 a <base in an inline SCRIPT string is left verbatim — rewriting it broke the JS', () => {
    // The regex rewrote the tag INSIDE the string literal, producing
    // `var s = "<base href="https://…">"` — a syntax error, so the script did
    // not run at all. The browser tier asserts the script still executes.
    const { html, hadExistingBase, baseHref } = injectBaseHref(
      '<head><script>var s = "<base href=\'/scripted/\'>";</script></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(false);
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(html).toBe(
      '<head><base href="https://blocks-fixture.example/engine/">' +
        '<script>var s = "<base href=\'/scripted/\'>";</script></head>',
    );
  });

  it('a <base in a <style> body is left verbatim too', () => {
    const { html, hadExistingBase } = injectBaseHref(
      '<head><style>.a::after{content:"<base href=\'/styled/\'>"}</style></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(false);
    expect(html).toBe(
      '<head><base href="https://blocks-fixture.example/engine/">' +
        '<style>.a::after{content:"<base href=\'/styled/\'>"}</style></head>',
    );
  });

  it('a </SCRIPT> end tag is matched case-insensitively, so markup after it is seen again', () => {
    // POSITIVE CONTROL for the raw-text skip: it must END. If the scanner
    // swallowed the rest of the document the real `<base href>` after the
    // script would be missed and `hadExistingBase` would read false.
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<head><SCRIPT>var s = "<base>";</SCRIPT><base href="/after-script/"></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(true);
    expect(baseHref).toBe('https://blocks-fixture.example/after-script/');
    expect(html).toBe(
      '<head><SCRIPT>var s = "<base>";</SCRIPT>' +
        '<base href="https://blocks-fixture.example/after-script/"></head>',
    );
  });

  it('🔴 a QUOTED ATTRIBUTE VALUE may contain ">", on <base> and on <head>', () => {
    // The regex ended every tag at the first `>`, so it read this `<base>` as
    // having no href at all and silently DISCARDED the author's declared base.
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<head data-tip="7>3"><base data-tip="9>4" href="/quoted/"></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(true);
    expect(baseHref).toBe('https://blocks-fixture.example/quoted/');
    expect(html).toBe(
      '<head data-tip="7>3"><base href="https://blocks-fixture.example/quoted/"></head>',
    );
  });

  it('a single-quoted attribute value may contain ">" as well', () => {
    const { html } = injectBaseHref("<head data-tip='7>3'><title>t</title></head>", DOC_URL);
    expect(html).toBe(
      "<head data-tip='7>3'><base href=\"https://blocks-fixture.example/engine/\">" +
        '<title>t</title></head>',
    );
  });

  it('an UPPERCASE <BASE HREF> is the document base, and a Mixed-Case one too', () => {
    const upper = injectBaseHref('<HEAD><BASE HREF="/shouted/"></HEAD>', DOC_URL);
    expect(upper.hadExistingBase).toBe(true);
    expect(upper.baseHref).toBe('https://blocks-fixture.example/shouted/');
    expect(upper.html).toBe(
      '<HEAD><base href="https://blocks-fixture.example/shouted/"></HEAD>',
    );

    const mixed = injectBaseHref('<Head><Base HrEf="/murmured/"></Head>', DOC_URL);
    expect(mixed.hadExistingBase).toBe(true);
    expect(mixed.baseHref).toBe('https://blocks-fixture.example/murmured/');
    expect(mixed.html).toBe(
      '<Head><base href="https://blocks-fixture.example/murmured/"></Head>',
    );
  });

  it('🔴 TWO <base href> tags: the FIRST is rewritten, the second left inert — TWO in the output', () => {
    // The claim "the output never carries two <base> tags" was FALSE and is now
    // corrected at every surface. What is guaranteed is that the base the
    // PARSER uses — the first — is the absolute one. Pinned as a literal, and
    // with the count, so nobody "fixes" this back into a de-duplication without
    // deciding to.
    const { html, baseHref, hadExistingBase } = injectBaseHref(
      '<head><base href="/winner/"><base href="/loser/"></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(true);
    expect(baseHref).toBe('https://blocks-fixture.example/winner/');
    expect(html).toBe(
      '<head><base href="https://blocks-fixture.example/winner/">' +
        '<base href="/loser/"></head>',
    );
    expect(html.match(/<base\b/gi)?.length).toBe(2);
  });

  it('a <base target> BEFORE a real <base href> does not shadow it', () => {
    const { baseHref, hadExistingBase } = injectBaseHref(
      '<head><base target="_top"><base href="/second-wins/"></head>',
      DOC_URL,
    );
    expect(hadExistingBase).toBe(true);
    expect(baseHref).toBe('https://blocks-fixture.example/second-wins/');
  });
});

describe('injectBaseHref — the scan is LINEAR, not quadratic', () => {
  /**
   * 🔴 A TIMING GUARD, AND IT HAS BEEN WATCHED TO FAIL. Reinstating the retired
   * regex existing-base walk (`html.matchAll(/<base\b[^>]*>/gi)` + an `href`
   * pattern per tag — the "two linear regexes" revision that cleared CodeQL's
   * alert and left the asymptotics quadratic) reddens exactly this test with its
   * own message, `expected 2722.071061 to be less than 500`, while the benign
   * control below stays green.
   *
   * MEASURED MARGINS on this input, 2026-10-03, over four runs: the scanner
   * 2-8 ms (the 8 was a cold first call; 2-3 ms in-suite), the regex walk
   * 2,722 ms. The benign 576 KB control ran 10-15 ms throughout. The bound sits
   * ~60x above the scanner's WORST observed time and ~5.4x below the regex
   * walk's, which is what keeps it from flaking on a loaded machine while still
   * catching a return to quadratic.
   */
  const LINEAR_BUDGET_MS = 500;

  it('🔴 a pathological 192 KB document completes well inside the budget', () => {
    // `'<base '.repeat(32000)`: 32,000 `<base` starts and NOT ONE `>`, which is
    // the worst case for a pattern that rescans `[^>]*` from every start
    // position. 192,000 characters — an ordinary size for an engine build's
    // index.html with an inlined loader.
    const pathological = '<base '.repeat(32_000);
    expect(pathological.length).toBe(192_000);

    const started = performance.now();
    const { baseHref, hadExistingBase } = injectBaseHref(pathological, DOC_URL);
    const elapsed = performance.now() - started;

    // Correctness first: not one of those `<base` tags is ever closed, so none
    // of them sets a base URL. Without this the guard could pass by returning
    // early on garbage.
    expect(hadExistingBase).toBe(false);
    expect(baseHref).toBe('https://blocks-fixture.example/engine/');
    expect(elapsed).toBeLessThan(LINEAR_BUDGET_MS);
  });

  it('CONTROL: a BENIGN document 3x larger is also inside the budget', () => {
    // 576 KB of ordinary markup. The pair is what attributes a failure to the
    // SHAPE of the input rather than to this machine being slow: if both are
    // over budget the box is wedged, if only the pathological one is, the scan
    // has gone quadratic again.
    const benign = '<p>hello</p>'.repeat(48_000);
    expect(benign.length).toBe(576_000);

    const started = performance.now();
    injectBaseHref(benign, DOC_URL);
    expect(performance.now() - started).toBeLessThan(LINEAR_BUDGET_MS);
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
    const mock = stubFetch(async (u) => textResponse(200, DOC_WITH_HEAD, u));

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
    stubFetch(async (u) => textResponse(200, '<head><base href="/pkg/">', u));
    const result = await fetchNestedDocument({ src: DOC_URL });
    expect(result.hadExistingBase).toBe(true);
    expect(result.baseHref).toBe('https://blocks-fixture.example/pkg/');
  });

  it('it does NOT sanitize: scripts and inline handlers come back verbatim', async () => {
    // A documented decision, pinned so it cannot be "hardened" into a silent
    // behaviour change. The nested document is the app's OWN bundle; stripping
    // its scripts would remove the thing it exists to run.
    const hostile = '<head></head><body onload="go()"><script>globalThis.x=1</script>';
    stubFetch(async (u) => textResponse(200, hostile, u));
    const { srcDoc } = await fetchNestedDocument({ src: DOC_URL });
    expect(srcDoc).toBe(
      '<head><base href="https://blocks-fixture.example/engine/"></head>' +
        '<body onload="go()"><script>globalThis.x=1</script>',
    );
  });
});

describe("fetchNestedDocument — the base comes from the RESPONSE's final URL", () => {
  it('🔴 a redirect moves the base with it, and `url` reports where the body came from', async () => {
    // `fetch` follows redirects, so `src: '/game'` answered with a 301 to
    // `/game/index.html` lands the document one directory DEEPER than the
    // request names. Basing on the requested URL resolves every relative asset
    // one directory too high, and the only symptom is a pile of 404s with
    // nothing naming the base.
    const mock = stubFetch(async () =>
      redirectedResponse(DOC_WITH_HEAD, `${HOST}/arcade/index.html`),
    );

    const result = await fetchNestedDocument({ src: `${HOST}/arcade` });

    // The REQUEST went to the un-redirected URL…
    expect(mock.mock.calls[0]?.[0]).toBe('https://blocks-fixture.example/arcade');
    // …and everything derived from the document names where it actually landed.
    expect(result.url).toBe('https://blocks-fixture.example/arcade/index.html');
    expect(result.baseHref).toBe('https://blocks-fixture.example/arcade/');
    expect(result.srcDoc).toBe(
      '<!doctype html><html><head><base href="https://blocks-fixture.example/arcade/">' +
        '<title>Engine</title></head>' +
        '<body><script type="module" src="loader.mjs"></script></body></html>',
    );
  });

  it('a cross-directory redirect is followed too, not just a trailing-slash one', async () => {
    // A second, structurally different redirect: the final URL shares no path
    // segment with the request, so an implementation that merely appended a
    // slash to the requested URL would fail here.
    stubFetch(async () => redirectedResponse('<head></head>', `${HOST}/cdn/v9/entry.html`));

    const result = await fetchNestedDocument({ src: `${HOST}/engine/boot.html` });

    expect(result.url).toBe('https://blocks-fixture.example/cdn/v9/entry.html');
    expect(result.baseHref).toBe('https://blocks-fixture.example/cdn/v9/');
  });

  it('FALLBACK: a Response with no `url` bases on the REQUESTED url', async () => {
    // An exotic runtime, or a `Response` stand-in that does not carry one. This
    // is also the control that stops the test above passing for an
    // implementation that reads `response.url` unconditionally and throws on
    // `undefined`.
    stubFetch(async () => urllessResponse(DOC_WITH_HEAD));

    const result = await fetchNestedDocument({ src: DOC_URL });

    expect(result.url).toBe('https://blocks-fixture.example/engine/boot.html');
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/');
  });
});

describe('fetchNestedDocument — resolving a relative src', () => {
  it('resolves against an explicit baseUrl', async () => {
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));

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
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));

    const result = await fetchNestedDocument({ src: 'nested/view.html' });

    expect(mock.mock.calls[0]?.[0]).toBe(
      'https://blocks-fixture.example/engine/nested/view.html',
    );
    expect(result.baseHref).toBe('https://blocks-fixture.example/engine/nested/');
  });

  it('falls back to location.href when there is no document', async () => {
    vi.stubGlobal('location', { href: `${HOST}/engine/boot.html` });
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));

    await fetchNestedDocument({ src: 'view.html' });

    expect(mock.mock.calls[0]?.[0]).toBe('https://blocks-fixture.example/engine/view.html');
  });

  it('a relative src with NO document base is an invalid-url error, and names why', async () => {
    // Node, a worker, SSR. No fetch is attempted.
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));

    await expect(fetchNestedDocument({ src: 'boot.html' })).rejects.toThrow(
      'fetchNestedDocument: cannot resolve src "boot.html" — it is relative and this runtime ' +
        'has no document base URL. Pass an absolute src, or options.baseUrl.',
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it('POSITIVE CONTROL: the same stub DOES get called for an absolute src', async () => {
    // The `not.toHaveBeenCalled()` above is otherwise indistinguishable from a
    // stub that was never wired to the helper at all.
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));
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
    stubFetch(async (u) => textResponse(404, 'nope', u));

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
    stubFetch(async (u) => textResponse(500, '', u));
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
    const mock = stubFetch(async (u) => textResponse(200, '<head></head>', u));

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
