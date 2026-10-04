/**
 * Embedding one of your own bundled documents inside a block — the `srcdoc`
 * pattern, and why a plain `<iframe src>` cannot work.
 *
 * WHY THIS EXISTS
 * ===============
 * Two platform policies combine so that a block can never frame its own
 * bundled content by URL. Neither is a bug, and neither has a manifest-side
 * workaround:
 *
 *   1. A block's own frame is sandboxed with the manifest's `iframe.sandbox`
 *      tokens intersected by a trust-tier allowlist. An unverified block keeps
 *      `allow-scripts allow-forms` and nothing else — `allow-same-origin` is
 *      refused at `civitai app validate` time ("forbidden outside the internal
 *      trust tier") and re-stripped host-side even if it reached the manifest.
 *      So the block document's origin is OPAQUE: `window.origin === "null"`.
 *
 *   2. Every path served from `https://<blockId>.civit.ai/` — `.html`, `.js`,
 *      `.wasm`, archive files, all of it — carries
 *      `Content-Security-Policy: frame-ancestors …` plus
 *      `X-Frame-Options: SAMEORIGIN`. Those headers are stamped at the platform
 *      edge, not by the block's own server, so a block cannot override them.
 *
 * `frame-ancestors` is checked against EVERY ancestor of the framed document.
 * An opaque origin matches no source list — measured, including the wide-open
 * `frame-ancestors *` — because CSP3 ASCII-serializes the ancestor origin and
 * then URL-parses it, and the string `"null"` fails that parse, returning
 * Blocked before any source matching happens. So widening the allowlist cannot
 * fix this, and `X-Frame-Options: SAMEORIGIN` blocks it a second time on its
 * own.
 *
 * 🔴 EXTERNAL PLATFORM MEASUREMENT — NOTHING IN THIS REPO VERIFIES THE MATRIX
 * BELOW. It was taken on 2026-10-03 against a local two-origin Chromium replica
 * of the platform's frame topology (sandbox `allow-scripts allow-forms`, nested
 * document framed from the opaque-origin parent). That replica is deliberately
 * NOT committed here — it would be a second, drifting model of a platform this
 * package does not own — so no test in this package exercises any row, and a
 * green suite says nothing about them. Treat the table as a dated observation of
 * the platform, not as a pinned property of this code: RE-MEASURE IT if the
 * platform changes its sandbox trust tiers or the response headers its static
 * host stamps.
 *
 *   headers on the nested document            result
 *   ----------------------------------------  ---------
 *   (none)  ← positive control                LOADED
 *   frame-ancestors *                         BLOCKED
 *   frame-ancestors <app-host> <top-host>     BLOCKED
 *   frame-ancestors <unrelated>  ← control    BLOCKED
 *   X-Frame-Options: SAMEORIGIN only          BLOCKED
 *
 * Within that replica the positive control is what makes the four BLOCKEDs mean
 * something: the harness CAN load a nested document, so the blocks are the
 * headers and not the replica. That is a claim about the replica's internal
 * consistency; it is not a claim that the replica matches production.
 *
 * WHAT THIS MODULE DOES
 * =====================
 * The one thing that works: fetch the nested document's HTML (the static host
 * sends `Access-Control-Allow-Origin: *`, so a null-origin `fetch` succeeds
 * where a frame load does not), rewrite its base URL to the absolute location
 * it was fetched from, and hand the string to an iframe's `srcdoc`. A `srcdoc`
 * frame inherits the parent's opaque origin and carries NO response headers of
 * its own, so neither policy applies to it.
 *
 * 🔴 PREFER A SINGLE-DOCUMENT DESIGN. An engine build (Defold, Unity, Phaser,
 * …) is a `<canvas>` plus a JS loader and normally mounts straight into the
 * block's own document — no nested frame, no `<base>` rewrite, none of this
 * module. Reach for the helper only when a separate document is genuinely
 * required (a third-party viewer that insists on owning `document`, a build you
 * cannot alter).
 *
 * 🔴 THE RETURNED STRING IS NOT SANITIZED, ON PURPOSE. It is your own bundled
 * markup and scripts; stripping them would remove the thing the nested document
 * exists to run. The consequence is the contract: pass a `src` you control.
 * `fetchNestedDocument` is not a way to inline a document from somewhere else,
 * and the returned string carries whatever the fetched bytes said. Put your own
 * `sandbox` attribute on the iframe you hand it to.
 *
 * 🔴 KNOWN LIMITS. {@link injectBaseHref} is a SINGLE-PASS TOKENIZER, not an
 * HTML parse (see `scanDocument`): it walks the document left to right once,
 * tracking comments, `<script>`/`<style>` raw-text bodies and quoted attribute
 * values, and locates the opening `<head>` and the first base-setting `<base>`
 * only in real markup. It builds no tree, so it does not know element nesting,
 * implied tags, or which `<head>` a stray tag would really have landed in.
 * The cases it still gets wrong, none of which it previously got right either:
 *
 *   - `<title>` and `<textarea>` hold ESCAPABLE raw text, which this scanner
 *     does not model — a literal `<base href=…>` written inside one is read as
 *     markup. (`<script>`/`<style>`, the two bodies a build tool actually emits
 *     markup-shaped strings into, ARE skipped.)
 *   - A `<base>` inside a conditional comment, a `<template>`, or markup a
 *     script writes at runtime is invisible or treated at face value, because
 *     there is no DOM here to ask.
 *   - It does nothing about assets a script resolves by hand from `location.*`:
 *     `<base>` moves `document.baseURI` and relative URLs in markup, not a
 *     string a loader built from `location.pathname`.
 *
 * A real parse would mean a DOM dependency on a zero-dependency, worker-safe
 * surface, which is the trade this scanner exists to avoid.
 */

/** Why a {@link NestedDocumentError} was thrown. Branch on this, not on the message. */
export type NestedDocumentErrorCode =
  /** `src` (against `baseUrl`, or the current document) is not a resolvable URL. */
  | 'invalid-url'
  /** The document was fetched and the host answered with a non-2xx status. */
  | 'http-error'
  /** The fetch itself failed — offline, DNS, TLS, a CORS rejection, no `fetch` global. */
  | 'network-error';

/**
 * Thrown by {@link fetchNestedDocument} and {@link injectBaseHref}. Carries a
 * {@link NestedDocumentErrorCode} so a caller can tell "you gave me a bad URL"
 * from "the host said 404" from "the network refused", which are three
 * different things to show a user.
 */
export class NestedDocumentError extends Error {
  override readonly name = 'NestedDocumentError';
  /** Machine-readable reason. */
  readonly code: NestedDocumentErrorCode;
  /** The absolute URL involved, when one was resolved before the failure. */
  readonly url: string | undefined;
  /** HTTP status, set only for `code: 'http-error'`. */
  readonly status: number | undefined;

  constructor(
    message: string,
    options: {
      code: NestedDocumentErrorCode;
      url?: string | undefined;
      status?: number | undefined;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.code = options.code;
    this.url = options.url;
    this.status = options.status;
  }
}

/** What {@link injectBaseHref} returns. */
export interface InjectBaseHrefResult {
  /**
   * The document, with the `<base href>` the parser will USE made absolute.
   *
   * 🔴 NOT a de-duplication, and the difference is observable. What is
   * guaranteed is that the FIRST base-setting `<base>` — the only one an HTML
   * parser honours — carries {@link baseHref} as an absolute URL. Other
   * `<base>` tags are left exactly as they were: a document declaring
   * `<base href="/a/"><base href="/b/">` comes back with two, the first
   * rewritten and the second untouched (inert, as it already was), and a
   * `<base target>` with no `href` is left in place beside the inserted one.
   */
  html: string;
  /** The absolute href that `<base>` now carries. */
  baseHref: string;
  /** `true` if the input already declared a `<base href>`, which was replaced. */
  hadExistingBase: boolean;
}

/**
 * Give a document an absolute `<base href>` so its relative asset URLs still
 * resolve once it is running from a `srcdoc` frame.
 *
 * This is the whole mechanism, and the reason it is a separate function with
 * tests of its own: a `srcdoc` document's own base URL is `about:srcdoc`, which
 * inherits the embedder's — an opaque origin — so every `src="loader.js"` and
 * `url(font.woff2)` in the fetched markup resolves to nothing. A wrong or
 * missing `<base>` breaks every relative load in the document **with no error
 * naming the base**, which is why it is pinned by its own test.
 *
 * 🔴 MODULE-INTERNAL — NOT part of the public `./blocks` surface. It is exported
 * from this FILE so the unit suite can import it by path; `index.ts`
 * deliberately does not re-export it, because nothing in or out of the tree
 * calls the rewrite on its own and an export is far cheaper to add later than to
 * remove once published. Same for {@link InjectBaseHrefResult}. See the note
 * beside the `./nestedDocument.js` re-export in `index.ts`.
 *
 * ONE RULE, in both directions:
 *
 *   - no `<base href>` in the input → the base becomes the DIRECTORY of
 *     `documentUrl` (`…/game/index.html` → `…/game/`), which is what the
 *     document's relative URLs were written against.
 *   - a `<base href>` already present → it is RESOLVED against `documentUrl`
 *     and REPLACED by the absolute result. The author's intent is kept; only
 *     its form changes. A root-relative `<base href="/">`, which engine builds
 *     ship routinely, would otherwise resolve against the opaque origin and
 *     take every asset with it.
 *
 * Insertion point, in order: replacing the existing `<base href>`; immediately
 * after the opening `<head>` tag; immediately after a leading `<!doctype>`;
 * otherwise at the very start. A `<base>` in any of those positions is parsed
 * into the head and precedes every asset reference, which is the property that
 * matters.
 *
 * A `<base>` that declares only `target` and no `href` is left alone — per the
 * HTML spec it sets no document base URL — and the new absolute `<base href>` is
 * inserted as if there were none, so the output then holds two `<base>` tags.
 * See {@link InjectBaseHrefResult.html} for what is and is not guaranteed about
 * the count.
 *
 * 🔴 BUT `href=""` IS AN `href`, so it is base-setting and is REWRITTEN. The
 * spec keys on the `href` CONTENT ATTRIBUTE being present, not on its value
 * resolving to something new: `""` parses successfully against the document's
 * own URL, so `<base href="">` sets the base to `documentUrl` itself (not its
 * directory), and a whitespace-only value does the same because the URL parser
 * strips leading and trailing spaces. The distinction is load-bearing, not
 * pedantic — see the comment at the `wantHref` test in `scanDocument` for what
 * treating it as absent did to a document declaring `<base href=""><base
 * href="/real/">`.
 *
 * Only REAL MARKUP is considered: a `<base href>` or a `<head>` written inside
 * an HTML comment, or inside a `<script>`/`<style>` body, is ignored, and tag
 * names match case-insensitively. A quoted attribute value may contain `>`.
 *
 * @param html The document's markup, as fetched.
 * @param documentUrl The absolute URL `html` was fetched from.
 * @throws {NestedDocumentError} `code: 'invalid-url'` if `documentUrl` is not absolute.
 */
export function injectBaseHref(html: string, documentUrl: string): InjectBaseHrefResult {
  let docUrl: URL;
  try {
    docUrl = new URL(documentUrl);
  } catch (cause) {
    throw new NestedDocumentError(
      `injectBaseHref: documentUrl is not an absolute URL: ${documentUrl}`,
      { code: 'invalid-url', cause },
    );
  }

  const scan = scanDocument(html);
  const existing = scan.base;

  let baseHref: string;
  try {
    baseHref =
      existing === undefined ? new URL('.', docUrl).href : new URL(existing.href, docUrl).href;
  } catch (cause) {
    throw new NestedDocumentError(
      `injectBaseHref: the document's own <base href="${existing?.href ?? ''}"> does not resolve ` +
        `against ${docUrl.href}`,
      { code: 'invalid-url', url: docUrl.href, cause },
    );
  }

  const tag = `<base href="${escapeAttr(baseHref)}">`;

  if (existing !== undefined) {
    const before = html.slice(0, existing.index);
    const after = html.slice(existing.index + existing.length);
    return { html: `${before}${tag}${after}`, baseHref, hadExistingBase: true };
  }

  return { html: insertInto(html, tag, scan), baseHref, hadExistingBase: false };
}

/** Options for {@link fetchNestedDocument}. */
export interface FetchNestedDocumentOptions {
  /**
   * The nested document to inline. Absolute, or relative — a relative `src`
   * resolves against `baseUrl` when given, otherwise against the current
   * document's base URL (`document.baseURI`, falling back to `location.href`).
   * In a runtime with neither, a relative `src` is an `'invalid-url'`.
   */
  src: string;
  /** Explicit base for resolving a relative `src`. Defaults to the current document. */
  baseUrl?: string;
  /** Abort the fetch. Rejects with the underlying `AbortError`, not a `NestedDocumentError`. */
  signal?: AbortSignal;
}

/** What {@link fetchNestedDocument} resolves to. */
export interface NestedDocument {
  /** Hand this to an iframe's `srcdoc`. NOT sanitized — see the module header. */
  srcDoc: string;
  /**
   * The absolute URL the document was fetched from — the response's FINAL URL,
   * so a redirect is reflected here and `baseHref` is its directory. Falls back
   * to the requested URL in a runtime whose `Response` carries no `url`.
   */
  url: string;
  /** The absolute href the injected `<base>` carries. */
  baseHref: string;
  /** `true` if the fetched document already declared a `<base href>`, which was replaced. */
  hadExistingBase: boolean;
}

/**
 * Fetch one of your own bundled documents and return it as a `srcdoc` string
 * with an absolute `<base href>` injected.
 *
 * @example
 * ```ts
 * const { srcDoc } = await fetchNestedDocument({ src: '/game/index.html' });
 * iframe.setAttribute('sandbox', 'allow-scripts');
 * iframe.srcdoc = srcDoc;
 * ```
 *
 * @throws {NestedDocumentError} `'invalid-url'`, `'http-error'` (with `.status`)
 * or `'network-error'`. An abort via `options.signal` rejects with the
 * platform's own `AbortError` instead, so `signal.aborted` stays the way to tell
 * a cancellation from a failure.
 */
export async function fetchNestedDocument(
  options: FetchNestedDocumentOptions,
): Promise<NestedDocument> {
  const base = options.baseUrl ?? currentDocumentBaseUrl();

  let url: string;
  try {
    url = new URL(options.src, base).href;
  } catch (cause) {
    throw new NestedDocumentError(
      `fetchNestedDocument: cannot resolve src "${options.src}"` +
        (base === undefined
          ? ' — it is relative and this runtime has no document base URL. Pass an absolute src, ' +
            'or options.baseUrl.'
          : ` against base "${base}".`),
      { code: 'invalid-url', cause },
    );
  }

  const doFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof doFetch !== 'function') {
    throw new NestedDocumentError(
      'fetchNestedDocument: this runtime has no global fetch.',
      { code: 'network-error', url },
    );
  }

  let response: Response;
  try {
    response = await doFetch(url, { signal: options.signal });
  } catch (cause) {
    // An abort is the caller's own doing, not a failure to report as one: pass
    // the platform AbortError straight through so `signal.aborted` keeps
    // meaning what it means.
    if (options.signal?.aborted) throw cause;
    throw new NestedDocumentError(
      `fetchNestedDocument: request to ${url} failed. A block runs at an opaque origin, so the ` +
        'host must answer with Access-Control-Allow-Origin.',
      { code: 'network-error', url, cause },
    );
  }

  if (!response.ok) {
    throw new NestedDocumentError(
      `fetchNestedDocument: ${url} returned HTTP ${response.status}.`,
      { code: 'http-error', url, status: response.status },
    );
  }

  let html: string;
  try {
    html = await response.text();
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    throw new NestedDocumentError(
      `fetchNestedDocument: reading the body of ${url} failed.`,
      { code: 'network-error', url, cause },
    );
  }

  // 🔴 THE BASE IS RESOLVED AGAINST THE RESPONSE'S FINAL URL, NOT THE REQUESTED
  // ONE. `fetch` follows redirects by default, and a `src` of `/game` answered
  // with a 301 to `/game/index.html` lands the document one directory deeper
  // than the request names. Basing on the requested URL then resolves every
  // relative asset one directory TOO HIGH — silently, because the only symptom
  // is a pile of 404s with nothing naming the base. `Response.url` is the
  // serialized final URL and is what `document.baseURI` would have been had the
  // document loaded normally. A `Response` stand-in without one (a stub, an
  // exotic runtime) falls back to the requested URL, i.e. the previous
  // behaviour.
  const responseUrl = (response as { url?: unknown }).url;
  const documentUrl = typeof responseUrl === 'string' && responseUrl !== '' ? responseUrl : url;

  const { html: srcDoc, baseHref, hadExistingBase } = injectBaseHref(html, documentUrl);
  return { srcDoc, url: documentUrl, baseHref, hadExistingBase };
}

/* ----------------------------------------------------------------- internals */

/** What one pass of {@link scanDocument} found. All indices are into the input. */
interface DocumentScan {
  /** Index just PAST the first real opening `<head …>` tag. */
  headEndsAt: number | undefined;
  /** Index just PAST a doctype declaration that is the document's first node. */
  doctypeEndsAt: number | undefined;
  /** The first real `<base>` that sets a base URL, i.e. the one the parser uses. */
  base: { index: number; length: number; href: string } | undefined;
}

/**
 * Elements whose content is RAW TEXT: `<` inside them starts no tag, so markup
 * written in a JS string literal or a CSS value is content, not structure.
 *
 * `title`/`textarea` hold *escapable* raw text and are deliberately NOT here —
 * modelling them needs entity handling this scanner does not do, and neither is
 * a place a build tool emits markup-shaped strings. Stated as a known limit in
 * the module header.
 */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

/** The five characters HTML counts as whitespace. */
function isHtmlSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** A tag name must START with an ASCII letter, or the `<` is literal text. */
function isAsciiAlpha(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

/**
 * ONE LEFT-TO-RIGHT PASS over the document, locating the opening `<head>`, a
 * leading doctype and the first base-setting `<base>` — in REAL MARKUP only.
 *
 * 🔴 WHY THIS IS A SCANNER AND NOT TWO REGEXES, measured. The regex version
 * found a `<base href>` or a `<head>` wherever the characters appeared, which is
 * not where the parser finds them, and three of those disagreements were
 * actively harmful rather than merely over-eager:
 *
 *   - a `<base href>` inside an HTML COMMENT was "found", and the replacement
 *     was spliced INSIDE the comment — leaving the document with ZERO base
 *     elements, where ignoring the comment inserts after `<head>` and works.
 *     Detection turned a working document into a broken one.
 *   - a `<base` inside an inline SCRIPT STRING was rewritten, corrupting the JS
 *     (`var s = "<base href="https://…">"`) so the script did not run at all.
 *   - a `<base>` whose attribute value contained `>` (`<base data-x="a>b"
 *     href="/pkg/">`) was not recognised as having an `href`, so the author's
 *     declared base was silently discarded.
 *
 * 🔴 AND IT IS LINEAR, WHICH THE REGEX VERSION WAS NOT — including the
 * "two linear regexes" revision that answered CodeQL's `js/polynomial-redos`
 * alert. `/<base\b[^>]*>/g` still retries `[^>]*` from every `<base` start
 * position when the document holds a long run with no `>`, so a document of
 * `'<base '.repeat(n)` cost quadratic time: measured 4x per doubling, 2.8 s on a
 * 192 KB input. Fixing the ALERT is not the same as fixing the ASYMPTOTICS.
 * Every loop below advances its cursor by at least one character per iteration
 * and never restarts, and the only allocations are bounded-length tag/attribute
 * names — so the whole pass is O(document length). Pinned by the pathological
 * input guard in `test/blocks/nestedDocument.test.ts`.
 */
function scanDocument(html: string): DocumentScan {
  const n = html.length;
  let headEndsAt: number | undefined;
  let doctypeEndsAt: number | undefined;
  let base: { index: number; length: number; href: string } | undefined;

  // A doctype only counts when it is the document's FIRST node. Tracked as a
  // flag rather than re-inspecting the prefix, which would itself be quadratic.
  let atFirstNode = true;

  let i = 0;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;

    // Text before this `<`. Non-whitespace text is a node, so a doctype after
    // it is not leading. Cheap: the scan stops at the first such character and
    // the flag is never re-raised.
    if (atFirstNode) {
      for (let p = i; p < lt; p++) {
        if (!isHtmlSpace(html[p])) {
          atFirstNode = false;
          break;
        }
      }
    }

    // ── A comment. Everything inside it is invisible. ──────────────────────
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      atFirstNode = false;
      continue;
    }

    // ── A markup declaration (`<!doctype …>`) or a bogus comment (`<?…>`). ──
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const gt = html.indexOf('>', lt + 2);
      const end = gt < 0 ? n : gt + 1;
      if (
        atFirstNode &&
        doctypeEndsAt === undefined &&
        html.slice(lt + 2, lt + 9).toLowerCase() === 'doctype' &&
        !isAsciiAlpha(html[lt + 9])
      ) {
        doctypeEndsAt = end;
      }
      i = end;
      atFirstNode = false;
      continue;
    }

    // ── A start or end tag. ────────────────────────────────────────────────
    let j = lt + 1;
    const closing = html[j] === '/';
    if (closing) j++;
    if (!isAsciiAlpha(html[j])) {
      // Not a tag: the `<` is literal text content.
      i = lt + 1;
      atFirstNode = false;
      continue;
    }

    const nameStart = j;
    while (j < n && !isHtmlSpace(html[j]) && html[j] !== '/' && html[j] !== '>') j++;
    // Lowercased so `<HEAD`, `<Base` and `<BASE` all match, while `<header`
    // and `<basefont` do not — the tag name is compared WHOLE, which is what
    // the old `\b` in the pattern was standing in for.
    const name = html.slice(nameStart, j).toLowerCase();

    const wantHref = !closing && name === 'base' && base === undefined;
    let href: string | undefined;

    // Walk the attributes to find where this tag really ends. A QUOTED VALUE
    // MAY CONTAIN `>` — which is the whole reason this cannot be `indexOf('>')`.
    let k = j;
    while (k < n && html[k] !== '>') {
      if (isHtmlSpace(html[k]) || html[k] === '/') {
        k++;
        continue;
      }
      const attrNameStart = k;
      while (
        k < n &&
        !isHtmlSpace(html[k]) &&
        html[k] !== '/' &&
        html[k] !== '>' &&
        html[k] !== '='
      ) {
        k++;
      }
      if (k === attrNameStart) {
        // A stray `=` with no name before it. Consume it so the loop advances.
        k++;
        continue;
      }
      const attrName = html.slice(attrNameStart, k).toLowerCase();

      let p = k;
      while (p < n && isHtmlSpace(html[p])) p++;
      let value = '';
      if (html[p] === '=') {
        p++;
        while (p < n && isHtmlSpace(html[p])) p++;
        const quote = html[p];
        if (quote === '"' || quote === "'") {
          p++;
          const from = p;
          while (p < n && html[p] !== quote) p++;
          value = html.slice(from, p);
          if (p < n) p++; // past the closing quote
        } else {
          const from = p;
          while (p < n && !isHtmlSpace(html[p]) && html[p] !== '>') p++;
          value = html.slice(from, p);
        }
        k = p;
      }
      // The FIRST `href` wins, which is what an HTML parser does with a
      // duplicate attribute.
      if (wantHref && href === undefined && attrName === 'href') href = value;
    }
    const tagEnd = k < n ? k + 1 : n;

    if (!closing && name === 'head' && headEndsAt === undefined) headEndsAt = tagEnd;
    // 🔴 AN EMPTY `href` IS BASE-SETTING — this line read `href !== ''` and
    // that was wrong. Per HTML the document base URL comes from the first
    // `<base>` that HAS an `href` CONTENT ATTRIBUTE, and `""` parses
    // successfully against the document's own URL, so `<base href="">` sets
    // the base to the document URL rather than setting none. Reading it as
    // absent is harmful rather than merely imprecise: the inserted absolute
    // base goes in BEFORE it, so this tag stays the first base-setting element
    // the parser honours and `document.baseURI` becomes the EMBEDDER's URL —
    // the opaque-origin failure this whole module exists to prevent, with a
    // `baseHref` the caller is told is in use when it is not. A whitespace-only
    // `href` is the same case for the same reason: the URL parser strips
    // leading and trailing spaces, so `href="   "` also resolves to the
    // document URL. Only a `<base>` with NO `href` attribute at all sets no
    // base URL, and that case is `href === undefined` here.
    if (wantHref && href !== undefined) {
      base = { index: lt, length: tagEnd - lt, href };
    }

    atFirstNode = false;
    i = tagEnd;

    // A raw-text element's body is content, not markup. Resume at its end tag
    // so the end tag itself is still tokenized normally.
    if (!closing && RAW_TEXT_ELEMENTS.has(name)) {
      i = findRawTextEnd(html, name, tagEnd);
    }
  }

  return { headEndsAt, doctypeEndsAt, base };
}

/**
 * Index of the `<` that opens `</name…>`, or the end of the document if the
 * element is never closed — which is also what a real parser does with an
 * unterminated `<script>`.
 */
function findRawTextEnd(html: string, name: string, from: number): number {
  const needle = `</${name}`;
  let at = from;
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    if (lt < 0) return html.length;
    // `slice` of a bounded length, so this allocation is O(1) per `<`.
    if (html.slice(lt, lt + needle.length).toLowerCase() === needle) {
      const after = html[lt + needle.length];
      if (after === undefined || isHtmlSpace(after) || after === '>' || after === '/') return lt;
    }
    at = lt + 1;
  }
  return html.length;
}

/**
 * Escape a value for a double-quoted HTML attribute. `URL#href` percent-encodes
 * `"`, `<` and `>` already, so `&` is the character that actually occurs here —
 * the other three are covered because this must not depend on that.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Insert `tag` after the opening `<head>`, else after a leading doctype, else at the start. */
function insertInto(html: string, tag: string, scan: DocumentScan): string {
  const at = scan.headEndsAt ?? scan.doctypeEndsAt;
  if (at === undefined) return `${tag}${html}`;
  return `${html.slice(0, at)}${tag}${html.slice(at)}`;
}

/**
 * The current document's base URL, or `undefined` in a runtime without one
 * (Node, a worker, SSR). `document.baseURI` is the right reading rather than
 * `location.href`: it already accounts for a `<base>` the block itself declares.
 */
function currentDocumentBaseUrl(): string | undefined {
  const scope = globalThis as {
    document?: { baseURI?: unknown };
    location?: { href?: unknown };
  };
  const fromDocument = scope.document?.baseURI;
  if (typeof fromDocument === 'string' && fromDocument !== '') return fromDocument;
  const fromLocation = scope.location?.href;
  if (typeof fromLocation === 'string' && fromLocation !== '') return fromLocation;
  return undefined;
}
