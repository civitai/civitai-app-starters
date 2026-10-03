---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the nested-document `srcdoc` helper, and document why a block cannot frame
its own bundled content.

**The constraint (#532).** A nested `<iframe src="…">` pointing at an app's own
bundle can never load, and nothing in the manifest fixes it. Two platform
policies combine: outside the internal trust tier the sandbox withholds
`allow-same-origin`, so the block document's origin is **opaque** (measured,
`window.origin === "null"`); and every path served from
`https://<blockId>.civit.ai/` carries `Content-Security-Policy: frame-ancestors
…` plus `X-Frame-Options: SAMEORIGIN`, stamped at the platform edge rather than
by the app's own server.

An **opaque ancestor matches no `frame-ancestors` source list at all** — `*`
included, because CSP3 ASCII-serializes the ancestor origin and URL-parses it,
and `"null"` fails that parse before any source matching happens. So widening
the allowlist is not a fix either. Measured in a two-origin Chromium replica,
where the no-headers positive control is what makes the BLOCKEDs attributable to
the headers rather than to the replica:

| nested document's headers | result |
|---|---|
| *(none)* — positive control | **LOADED** |
| `frame-ancestors *` | BLOCKED |
| `frame-ancestors <app-host> <top-host>` | BLOCKED |
| `frame-ancestors <unrelated>` — negative control | BLOCKED |
| `X-Frame-Options: SAMEORIGIN` only | BLOCKED |

**`@civitai/app-sdk/blocks` gains two values and three types** — minor, not
patch, because the `./blocks` subpath grows public surface:
`fetchNestedDocument(options)` and `NestedDocumentError`, plus
`FetchNestedDocumentOptions`, `NestedDocument` and `NestedDocumentErrorCode`.
Zero new dependencies; the module is browser-safe and the subpath stays
runtime-agnostic. The `<base href>` rewrite itself stays **module-internal**:
nothing in or out of the tree calls it on its own, and an export is far cheaper
to add later than to remove once published.

The helper does the one thing that works: fetch the document's markup (the
static host answers `Access-Control-Allow-Origin: *`, so a null-origin `fetch`
succeeds where a frame load does not), rewrite its base URL to the absolute
location it came from, and hand the string to an iframe's `srcdoc` — which
inherits the parent's opaque origin and carries no response headers of its own.

**The `<base href>` is the whole mechanism, and it fails silently.** A `srcdoc`
document's base URL is `about:srcdoc`, inheriting the embedder's, so every
relative `src=` in the fetched markup resolves to nothing and no error message
mentions a base. One rule covers both directions: with no `<base href>` the base
becomes the **directory** of the fetch URL (`…/game/index.html` → `…/game/`);
with one already present it is **resolved against the fetch URL and replaced**,
so the author's intent survives, its form becomes absolute, and the output never
carries two `<base>` tags. A `<base target>` with no `href` sets no base URL per
spec and is left alone.

**`@civitai/blocks-react` gains `useNestedDocument({ src, baseUrl })`** →
`{ srcDoc, status, error }`, with `status` in
`'idle' | 'loading' | 'ready' | 'error'`. The three fields come from one state
object, so `srcDoc` is non-null exactly when `ready` and `error` exactly when
`error`. A mount with a `src` starts at `loading` rather than flashing `idle`;
changing `src` restarts and aborts the previous fetch; unmounting aborts and
writes no state.

**Prefer a single-document design, and the docs now say so first.** An engine
build (Defold, Unity WebGL, Phaser) is a `<canvas>` plus a JS loader that
normally mounts straight into the block's own document, which avoids the problem
class entirely. The helper is the fallback for when a separate document is
genuinely required. `docs/build-your-first-app-block.md` carries that guidance
in full, immediately after the manifest's sandbox rules — where an author
designing the app actually hits it. Every other surface (both package READMEs,
the barrel comments, the two test headers) states the constraint in one sentence
and points at a single canonical derivation instead of restating it. It had been
duplicated across 11 surfaces with nothing checking them for agreement — which
is how two measured claims in the test headers beside it went stale.

**The returned string is deliberately NOT sanitized**, and that is stated at
every surface rather than left implicit: it is the app's own bundled markup and
scripts, and stripping them would remove the thing the nested document exists to
run. The consequence is the contract — pass a `src` you control, and put your own
`sandbox` attribute on the nested iframe.

**Coverage.** 34 unit tests in `@civitai/app-sdk`
(`test/blocks/nestedDocument.test.ts`) over every branch — base injection with
and without a `<head>`, with and without an existing `<base>`, quoted/unquoted/
empty hrefs, doctype-only and empty documents, relative-src resolution against
an explicit base / `document.baseURI` / `location.href` / nothing at all,
non-OK status, rejected fetch, failed body read, abort pass-through, and a
missing `fetch` global. Every expected value is a literal string, never derived
from the implementation.

13 browser-mode tests in `@civitai/blocks-react`
(`test/useNestedDocument.browser.test.tsx`) cover the hook's state machine and —
this is why they are in the browser tier — mount the produced string as a real
`srcdoc` and assert `img.src` **as Chromium resolved it**, so the base-href claim
is a measured resolution rather than a restatement of the string the
implementation built. A negative control renders the same markup *without* a
base and shows it resolving to the embedder instead. Suites that assert a zero
carry a positive control beside it.

Mutation-checked, five mutants, all killed — and one of them produced a finding
worth recording rather than a tick:

- **Delete the `<base>` insertion** (`return { html, … }` instead of
  `insertInto(html, tag)`) → 11 of 34 unit tests red, and 4 of 13 browser tests,
  including the in-browser mechanism test with exactly the production symptom:
  `expected 'http://localhost:63315/sprite.png' to be
  'https://nested-fixture.example/engine/sprite.png'`.
- **Base on the document instead of its directory** (`docUrl.href` instead of
  `new URL('.', docUrl).href`) → 15 of 34 unit tests red, first with
  `expected '<base href="…/engine/boot.html">' to be '<base href="…/engine/">'`.
  🔴 **But only 2 of the 13 browser tests see it** — the two that assert the
  whole `srcDoc` string; every in-browser `img.src` assertion SURVIVES it. That
  is not a gap in the test: a `<base href>` naming the document resolves a
  relative URL identically to one naming its directory, so the two are
  behaviourally equivalent for asset loading and no amount of resolution testing
  can separate them. The directory form is kept because it is what the caller is
  handed as `baseHref`; the literal-string assertions are what pin it, and that
  division is now stated in both test headers rather than left to look like
  redundant coverage.
- **Stop replacing an existing `<base href>`** → killed in every faithful
  spelling, but the count **depends on the spelling**, so there is no single
  number for this mutant: inserting alongside immediately after `<head>` → 2
  unit tests red; `findExistingBase` returning `undefined` → 5; detecting the
  tag but ignoring its href → 5. The `<base` occurrence-count assertion — the
  one written for exactly this case, because a second `<base>` is ignored by the
  parser and the document would silently keep its relative href as the effective
  one — is red in **all three**, which is what makes the guard sound rather than
  any one of the numbers.
- **Drop the `\b` after `<head`** in the opening-tag pattern → 1 red, with the
  base landing *inside* `<header>` — after the asset references, where it does
  nothing.
- **Drop the `\b` after `<base`** in the existing-base tag pattern → 1 red, with
  a `<basefont href>` read as the document's own base.

**One real defect was caught by CI and fixed in this branch, not worked around.**
The first revision found the existing `<base href>` with a single pattern,
`/<base\b[^>]*?\bhref\s*=\s*(…)[^>]*>/i`. CodeQL flagged it **high**,
`js/polynomial-redos`: a lazy `[^>]*?` nested inside a match that also ends in
`[^>]*` makes the engine retry the inner scan from every start position, so a
long run of non-`>` characters after a `<base` with no `href` costs quadratic
time in document length. The document is the app's own bundle, but it is still
library input. The fix splits it: `findExistingBase` walks `<base>` tags with
ONE quantifier (linear) and applies the `href` pattern to a single tag's
bounded text, so the whole walk is linear. Behaviour is unchanged — all 34 unit
tests passed before and after the refactor, and all five mutants above were
re-run against the new shape and are still killed.
