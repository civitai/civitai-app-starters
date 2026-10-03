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
 * MEASURED MATRIX (local two-origin Chromium replica, sandbox
 * `allow-scripts allow-forms`, nested document framed from the opaque-origin
 * parent):
 *
 *   headers on the nested document            result
 *   ----------------------------------------  ---------
 *   (none)  ← positive control                LOADED
 *   frame-ancestors *                         BLOCKED
 *   frame-ancestors <app-host> <top-host>     BLOCKED
 *   frame-ancestors <unrelated>  ← control    BLOCKED
 *   X-Frame-Options: SAMEORIGIN only          BLOCKED
 *
 * The positive control is what makes the four BLOCKEDs mean something: the
 * harness CAN load a nested document, so the blocks are the headers and not the
 * replica.
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
 * 🔴 KNOWN LIMITS. {@link injectBaseHref} is a TEXT transform, not an HTML
 * parse: it finds the first `<base href=…>` and the first `<head>` with regular
 * expressions — linear ones, see `findExistingBase` for why that is a
 * requirement and not a preference — so a `<base>` inside a comment or a
 * template string is treated
 * as real, and a document whose `<head>` appears only inside a comment gets its
 * `<base>` inserted at the comment instead. Both over-apply rather than
 * under-apply — the base is still absolute and still correct for ordinary
 * documents — and a parse would mean a DOM dependency on a zero-dependency,
 * worker-safe surface. It also does nothing about assets a script resolves by
 * hand from `location.*`: `<base>` moves `document.baseURI` and relative URLs
 * in markup, not a string a loader built from `location.pathname`.
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
  /** The document with exactly one absolute `<base href>` in it. */
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
 * This is the whole mechanism, and the reason it is a separate exported
 * function: a `srcdoc` document's own base URL is `about:srcdoc`, which inherits
 * the embedder's — an opaque origin — so every `src="loader.js"` and
 * `url(font.woff2)` in the fetched markup resolves to nothing. A wrong or
 * missing `<base>` breaks every relative load in the document **with no error
 * naming the base**, which is why it is pinned by its own test.
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
 * inserted as if there were none.
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

  const existing = findExistingBase(html);

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

  return { html: insertInto(html, tag), baseHref, hadExistingBase: false };
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
  /** The absolute URL the document was fetched from. */
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

  const { html: srcDoc, baseHref, hadExistingBase } = injectBaseHref(html, url);
  return { srcDoc, url, baseHref, hadExistingBase };
}

/* ----------------------------------------------------------------- internals */

/** Opening `<head>` tag, with or without attributes. */
const HEAD_OPEN = /<head\b[^>]*>/i;

/** A leading doctype declaration. */
const LEADING_DOCTYPE = /^\s*<!doctype\b[^>]*>/i;

/**
 * An `href` attribute inside ONE tag's text, quoted, single-quoted or bare.
 * Applied only to a matched tag, never to the whole document.
 */
const HREF_ATTR = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * The first `<base>` tag that sets a document base URL, i.e. the first one with
 * a non-empty `href`. Per the HTML spec a `<base>` with only `target` sets no
 * base URL, and a later `<base href>` is what the parser would use — so this
 * walks the `<base>` tags rather than taking the first one.
 *
 * 🔴 TWO REGEXES ON PURPOSE, AND THE REASON IS A SECURITY GATE, NOT STYLE. The
 * single-pattern version — `/<base\b[^>]*?\bhref\s*=\s*(…)[^>]*>/i` — nests a
 * lazy `[^>]*?` inside a match that also ends in `[^>]*`, which CodeQL flags as
 * `js/polynomial-redos` (high): on a long run of non-`>` characters after a
 * `<base` with no `href`, the engine retries the inner scan from every start
 * position, so the cost is quadratic in document length. The document is the
 * app's own bundle, but it is still library input and still attacker-reachable
 * for anyone who can influence a build. Here the tag scan is ONE quantifier
 * (linear) and the attribute scan runs against a single tag's bounded text, so
 * the whole walk is linear. Do not merge them back.
 */
function findExistingBase(
  html: string,
): { index: number; length: number; href: string } | undefined {
  // A fresh literal per call: a module-level `g` regex carries `lastIndex`
  // between calls, which would make this function's answer depend on the
  // previous one.
  for (const tag of html.matchAll(/<base\b[^>]*>/gi)) {
    const attr = HREF_ATTR.exec(tag[0]);
    if (attr === null) continue;
    const href = attr[1] ?? attr[2] ?? attr[3] ?? '';
    // An empty `href` sets no base URL either, so it is "absent" like `target`.
    if (href === '') continue;
    if (tag.index === undefined) continue;
    return { index: tag.index, length: tag[0].length, href };
  }
  return undefined;
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
function insertInto(html: string, tag: string): string {
  const head = HEAD_OPEN.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const doctype = LEADING_DOCTYPE.exec(html);
  if (doctype) {
    const at = doctype.index + doctype[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  return `${tag}${html}`;
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
