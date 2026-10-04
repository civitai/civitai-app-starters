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
the allowlist is not a fix either.

The table below is an **external platform measurement taken on 2026-10-03**, in
a local two-origin Chromium replica of the platform's frame topology. That
replica is deliberately not committed — it would be a second, drifting model of
a platform these packages do not own — so **no test here exercises any row, and
a green suite says nothing about them.** Treat it as a dated observation, and
re-measure it if the platform changes its sandbox trust tiers or the response
headers its static host stamps. Within the replica the no-headers positive
control is what makes the BLOCKEDs attributable to the headers rather than to
the harness; that is a claim about the replica's internal consistency, not that
the replica matches production.

| nested document's headers | result (replica, 2026-10-03) |
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
becomes the **directory of the response's final URL** (`…/game/index.html` →
`…/game/`), so a redirect is followed rather than resolved one directory too
high; with a `<base href>` already present it is **resolved against that URL and
replaced**, so the author's intent survives and its form becomes absolute. A
`<base target>` with no `href` sets no base URL per spec and is left alone.

**It is NOT a de-duplication, and an earlier draft of this changeset said it
was.** The claim "the output never carries two `<base>` tags" was false at five
surfaces and is corrected at all of them. What is guaranteed is that **the
`<base href>` an HTML parser USES — the first base-setting one — is absolute**.
Markup declaring `<base href="/a/"><base href="/b/">` comes back with two, the
first rewritten and the second left exactly as it was (inert, as it already
was); and a `<base target>` left in place sits beside the inserted one, which
the suite has asserted all along.

**Only real markup is rewritten.** A `<base href>` or a `<head>` inside an HTML
comment, or inside a `<script>`/`<style>` body, is ignored; tag names match
case-insensitively (`<HEAD>`, `<Base>`); and a quoted attribute value may
contain `>`.

**`@civitai/blocks-react` gains `useNestedDocument({ src, baseUrl })`** →
`{ srcDoc, status, error }`, with `status` in
`'idle' | 'loading' | 'ready' | 'error'`. The three fields come from one state
object, so `srcDoc` is non-null exactly when `ready` and `error` exactly when
`error`. A mount with a `src` starts at `loading` rather than flashing `idle`;
unmounting aborts the fetch and writes no state.

Changing `src` restarts and aborts the previous fetch, and `status` returns to
`'loading'` **in the same render that changes `src`** — so no frame ever shows
the previous document as `'ready'` beside a new `src`.

The fetch carries a **30-second deadline**. The hook owns its `AbortController`
and never exposes it, so without one a response that never arrived left the hook
on `'loading'` forever with nothing a caller could cancel. On the deadline the
request is aborted and `status` becomes `'error'` with a message naming the
timeout. 30 seconds matches this package's existing `'protocol'`-class bound
(`DEFAULT_REQUEST_TIMEOUT_MS`, `ENTITLEMENTS_TIMEOUT_MS`): a static-host round
trip with no person in the loop. A timeout is reported; the hook's own aborts
(unmount, a `src` change) stay silent, as they must.

**Prefer a single-document design, and the docs now say so first.** An engine
build (Defold, Unity WebGL, Phaser) is a `<canvas>` plus a JS loader that
normally mounts straight into the block's own document, which avoids the problem
class entirely. The helper is the fallback for when a separate document is
genuinely required. `docs/build-your-first-app-block.md` carries that guidance
in full, immediately after the manifest's sandbox rules — where an author
designing the app actually hits it. Every other surface (both package READMEs,
the barrel comments, the three test headers) states the constraint in one sentence
and points at a single canonical derivation instead of restating it. It had been
duplicated across 11 surfaces with nothing checking them for agreement — which
is how two measured claims in the test headers beside it went stale.

**The returned string is deliberately NOT sanitized**, and that is stated at
every surface rather than left implicit: it is the app's own bundled markup and
scripts, and stripping them would remove the thing the nested document exists to
run. The consequence is the contract — pass a `src` you control, and put your own
`sandbox` attribute on the nested iframe.

**Coverage.** 51 unit tests in `@civitai/app-sdk`
(`test/blocks/nestedDocument.test.ts`) over every branch — base injection with
and without a `<head>`, with and without an existing `<base>`, quoted/unquoted/
empty hrefs, doctype-only and empty documents, a `<base href>` and a `<head>`
hidden in an HTML comment, a `<base` inside an inline `<script>` and inside a
`<style>` body, `>` inside a double- and a single-quoted attribute value,
uppercase and mixed-case tags, two `<base href>` tags, relative-src resolution
against an explicit base / `document.baseURI` / `location.href` / nothing at
all, a redirected response, a response carrying no `url`, non-OK status,
rejected fetch, failed body read, abort pass-through, and a missing `fetch`
global. Every expected value is a literal string, never derived from the
implementation.

15 browser-mode tests in `@civitai/blocks-react`
(`test/useNestedDocument.browser.test.tsx`) cover the hook's state machine and —
this is why they are in the browser tier — mount the produced string as a real
`srcdoc` and assert `img.src` **as Chromium resolved it**, so the base-href claim
is a measured resolution rather than a restatement of the string the
implementation built. A negative control renders the same markup *without* a
base and shows it resolving to the embedder instead. One case mounts a document
whose inline script holds a `<base …>` **string literal** and asserts the script
still RUNS and the literal is byte-identical — a property only a real JS engine
can show, with a positive control proving a `srcdoc` script can set the title in
this harness at all. Suites that assert a zero carry a positive control beside
it.

7 unit-tier tests in `@civitai/blocks-react`
(`test/useNestedDocument.test.tsx`) pin the two properties the browser tier
structurally cannot see — the 30-second deadline (at the deadline, and a
29,999 ms boundary on the other side of it; an unmount abort NOT reported as a
timeout; the timer released synchronously on cleanup; and a control showing an
ordinary HTTP error still reports the host's own message) and that no render
pairs a new `src` with the previous document.

🔴 **A `Response` stub with no `url` is why the requested-vs-final URL defect was
invisible to both tiers**, so every stub in both files now carries one and the
redirect cases pass a different one on purpose.

**Mutation-checked, 17 mutants over the two implementation files, all killed**,
with the unmutated baseline run as the positive control (51/51, 7/7, 15/15).
Exact-literal replacement with the occurrence count asserted to be 1, restoring
from a `cp -a` copy and re-checking its sha256 after every restore, so a failed
restore cannot score a borrowed kill for the next mutant. Two of them produced
findings worth recording rather than a tick:

- **Delete the `<base>` insertion** (`return { html, … }` instead of
  `insertInto(html, tag, scan)`) → 19 of 51 unit tests red, and 5 of 15 browser
  tests, including the in-browser mechanism test with exactly the production
  symptom: `expected 'http://localhost:…/sprite.png' to be
  'https://nested-fixture.example/engine/sprite.png'`.
- **Base on the document instead of its directory** (`docUrl.href` instead of
  `new URL('.', docUrl).href`) → 26 of 51 unit tests red, first with
  `expected '<base href="…/engine/boot.html">' to be '<base href="…/engine/">'`.
  🔴 **But only 2 of the 15 browser tests see it** — the two that assert the
  whole `srcDoc` string; every in-browser `img.src` assertion SURVIVES it. That
  is not a gap in the test: a `<base href>` naming the document resolves a
  relative URL identically to one naming its directory, so the two are
  behaviourally equivalent for asset loading and no amount of resolution testing
  can separate them. The directory form is kept because it is what the caller is
  handed as `baseHref`; the literal-string assertions are what pin it, and that
  division is stated in both test headers rather than left to look like
  redundant coverage.
- **Stop replacing an existing `<base href>`** → killed in every faithful
  spelling, but the count **depends on the spelling**, so there is no single
  number for this mutant: inserting alongside immediately after `<head>` → 6
  unit tests red; the scan reporting no base at all → 10; detecting the tag but
  ignoring its href → 6. Two `<base`-occurrence-count assertions are red in
  **all three**, which is what makes the guard sound rather than any one of the
  numbers.
- **Mis-handle the quoted-attribute state** → also spelling-dependent, because
  the state has two characters in it: honouring only `'` → 10 red; honouring
  only `"` → 2 red. Each spelling is blind to the other quote character, which
  is why both a double- and a single-quoted `>` fixture are present.
- **Stop skipping HTML comments** → 2 red. 🔴 **This mutant SURVIVED the first
  sweep, and finding that is what the sweep was for.** The two plainest
  commented-`<base>`/`<head>` fixtures cannot see it: with the comment skip
  gone, the markup-declaration branch (`<!…>`) still swallows the comment,
  because it ends at the first `>` and those fixtures have none before the
  decoy. The guard was unreachable and scored a false green. Two fixtures with a
  `>` early in the comment reach it, and those are the two reds.
- **Stop skipping `<script>`/`<style>` bodies** → 2 unit red, and exactly 1
  browser red: the script-runs case, the only assertion anywhere that a real JS
  engine executed the rewritten document.
- **Drop tag-name case-insensitivity** → 2 red. **Match the tag name as a
  prefix** rather than whole (the scanner's equivalent of dropping a `\b`) → 1
  red each for `head` and `base`, the `<header>`/`<basefont>` test.
- **Ignore the response's final URL** → 2 red, the two redirect cases.
- **Reinstate the quadratic regex existing-base walk** → 6 red, including the
  pathological-input timing guard with its own message, `expected 2722.071061
  to be less than 500`, while the 576 KB **benign control stayed green**
  (10-15 ms over four runs). That pair is what attributes a failure to the
  input's SHAPE rather than to a loaded machine.
- **In the hook:** the deadline wired to the shared controller but not
  distinguished from an unmount (the swallowing described below) → 1 red,
  `expected 'loading' to be 'error'`; flagging without aborting → 1 red, same
  assertion, different cause; the constant 30_000 → 5_000 → 2 red (the message
  and the boundary); dropping the render-phase reset → 2 red; keeping the reset
  but returning the stale state → the same 2.
- 🔴 **Dropping `clearTimeout` from the effect cleanup also SURVIVED the first
  sweep**, and for a reason worth keeping: it changes no state at all, because
  `abort()` on an already-aborted controller is a no-op and `.finally` clears
  the timer a microtask later anyway. What it does change is that every unmount
  leaves a 30-second timer holding the effect's closure — so the pending-timer
  COUNT is the observable, and that assertion had to be added rather than
  assumed.

**Two real defects were fixed in this branch rather than worked around.**

1. **`js/polynomial-redos` (CodeQL, high) — and the alert was only half of it.**
   The first revision found the existing `<base href>` with a single pattern,
   `/<base\b[^>]*?\bhref\s*=\s*(…)[^>]*>/i`: a lazy `[^>]*?` nested inside a
   match that also ends in `[^>]*`, so the engine retries the inner scan from
   every start position. The second revision split it into two linear-looking
   regexes, which **cleared the alert and left the asymptotics quadratic** —
   `/<base\b[^>]*>/g` still rescans `[^>]*` from every `<base` start when the
   document holds a long run with no `>`. Measured at 4× per doubling and
   **2.8 s on a 192 KB input**. The fix is a single left-to-right scanner that
   advances its cursor by at least one character per iteration and never
   restarts, pinned by the timing guard above (2-8 ms at that same 192 KB,
   against a 500 ms bound).
2. **Finding a `<base>` in the wrong places was actively harmful, not merely
   over-eager.** A `<base href>` in an HTML comment was "found" and the
   replacement spliced *inside* the comment, leaving the document with **zero**
   base elements where ignoring the comment inserts after `<head>` and works; a
   `<base` in an inline script string was rewritten into a syntax error, so the
   script did not run at all; and a `<base>` whose attribute value contained `>`
   was read as having no `href`, silently discarding the author's declared base.
   The scanner tracks comments, raw-text bodies and quoted attribute values, so
   all three are now the documented behaviour with a literal-string test each.
