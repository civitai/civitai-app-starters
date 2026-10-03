---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the nested-document `srcdoc` helper, and document why a block cannot frame
its own bundled content.

**The constraint (#532).** Two platform policies combine so that a nested
`<iframe src="…">` pointing at an app's own bundle can never load, and nothing
in the manifest fixes it:

1. A block's frame is sandboxed with the manifest's `iframe.sandbox` tokens
   intersected by a trust-tier allowlist. Outside the internal tier
   `allow-same-origin` is refused at `civitai app validate` time and re-stripped
   host-side, so the block document's origin is **opaque** — measured,
   `window.origin === "null"`.
2. Every path served from `https://<blockId>.civit.ai/` — `.html`, `.js`,
   `.wasm`, archive files, all of it — carries
   `Content-Security-Policy: frame-ancestors …` plus
   `X-Frame-Options: SAMEORIGIN`. Both are stamped at the platform edge, not by
   the app's own server, so a build cannot override them.

`frame-ancestors` is checked against every ancestor, and an **opaque ancestor
matches no source list at all**. Measured in a two-origin Chromium replica with
positive and negative controls:

| nested document's headers | result |
|---|---|
| *(none)* — positive control | **LOADED** |
| `frame-ancestors *` | BLOCKED |
| `frame-ancestors <app-host> <top-host>` | BLOCKED |
| `frame-ancestors <unrelated>` — negative control | BLOCKED |
| `X-Frame-Options: SAMEORIGIN` only | BLOCKED |

CSP3 ASCII-serializes the ancestor origin and URL-parses it; `"null"` fails that
parse and returns *Blocked* before any source matching, which is why even `*`
does not help. The positive control is what makes the four BLOCKEDs attributable
to the headers rather than to the replica.

**`@civitai/app-sdk/blocks` gains three values and four types** — minor, not
patch, because the `./blocks` subpath grows public surface:
`fetchNestedDocument(options)`, `injectBaseHref(html, documentUrl)`,
`NestedDocumentError`, plus `FetchNestedDocumentOptions`, `NestedDocument`,
`InjectBaseHrefResult` and `NestedDocumentErrorCode`. Zero new dependencies; the
module is browser-safe and the subpath stays runtime-agnostic.

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
immediately after the manifest's sandbox rules — where an author designing the
app actually hits it — and both package READMEs repeat the constraint at their
own API surface.

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
  `insertInto(html, tag)`) → 10 of 34 unit tests red, and 4 of 13 browser tests,
  including the in-browser mechanism test with exactly the production symptom:
  `expected 'http://localhost:63315/sprite.png' to be
  'https://nested-fixture.example/engine/sprite.png'`.
- **Base on the document instead of its directory** (`docUrl.href` instead of
  `new URL('.', docUrl).href`) → 14 of 34 unit tests red, first with
  `expected '<base href="…/engine/boot.html">' to be '<base href="…/engine/">'`.
  🔴 **But the in-browser `img.src` test SURVIVES it**, and that is not a gap in
  the test — a `<base href>` naming the document resolves a relative URL
  identically to one naming its directory, so the two are behaviourally
  equivalent for asset loading. The directory form is kept because it is what
  the caller is handed as `baseHref`; the literal-string assertions are what
  pin it, and that division is now stated in both test headers rather than left
  to look like redundant coverage.
- **Stop replacing an existing `<base href>`** (insert alongside it instead) → 4
  unit tests red, including the `<base` occurrence count, which is the
  assertion written for exactly that case: a second `<base>` is ignored by the
  parser, so the document would silently keep its relative href as the
  effective one.
- **Drop the `\b` after `<head`** in the opening-tag pattern → 1 red, with the
  base landing *inside* `<header>` — after the asset references, where it does
  nothing.
- **Drop the `\b` after `<base`** in the existing-base pattern → 1 red, with a
  `<basefont href>` read as the document's own base.
