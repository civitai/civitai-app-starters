---
'@civitai/components': patch
'@civitai/theme': patch
---

Docs: drop the version from the copy-paste CDN `<link>` URLs, so the stylesheet
a reader loads can never fall behind the contract the same file documents.

`MARKUP.md`, both `README.md`s and `demo/index.html` pinned
`@civitai/theme@0.2.0` and `@civitai/components@0.3.0`. Both still return **HTTP
200** — jsDelivr serves every published version forever — so this never surfaced
as a broken link. It served an old stylesheet, and each file had reached the
point of contradicting itself. Measured on the CDN, with `@0.9.9` on both
packages as the negative control (404, 50-byte body):

- `theme@0.2.0/styles.css` — 200, 5,560 B, **zero** `--civitai-bp-*` tokens.
  `packages/civitai-theme/README.md` documents `var(--civitai-bp-md)` eleven
  lines above the link that pinned it, and the developer-docs responsive guide
  is written entirely against those tokens. `theme@0.3.0` ships all five
  (`xs`/`sm`/`md`/`lg`/`xl`), 5,826 B.
- `components@0.3.0/styles.css` — 200, 28,042 B, **zero** `data-nowrap` rules,
  and `[data-civitai-ui='group']` with no `flex-wrap`. `MARKUP.md` documents
  `data-nowrap="true"` as the opt-out for the wrapping `group` that shipped in
  `components@0.4.0` (31,970 B, 2 `data-nowrap` rules). So a reader following
  the current markup contract got the pre-`0.4.0` overflow behaviour and an
  attribute with nothing behind it — no console error, no failed request.

**Why unversioned rather than a bump to `@0.4.0`/`@0.3.0`.** A bump is the same
defect rescheduled — `0.3.1` (77ce989) already did exactly that, and these four
files were stale again one minor later. Nothing can catch it in-band: the two
packages version **independently** and publish on separate changesets, and
`MARKUP.md` is static prose shipped verbatim in `files` (npm → mirrored into
developer.civitai.com), so no build step is in a position to rewrite the pin.
Removing the version makes the rot structurally impossible instead of merely
deferred: `cdn.jsdelivr.net/npm/@civitai/<pkg>/styles.css` tracks the `latest`
dist-tag and resolves 200 on every CDN, because both packages already ship a
real root `styles.css` for exactly this reason (jsDelivr ignores package.json
`exports` — see the header comment on each build script).

The trade-off is stated where it belongs and taken deliberately: unversioned
means a future publish reaches a copy-pasted page unannounced. Pinned means the
page silently renders documented markup unstyled, which is the failure that has
actually happened, twice, and it fails in the direction that looks like the docs
being wrong. Unversioned can only be *ahead* of the docs — additive, so
undocumented rules exist but nothing documented goes missing. Each file now says
so at the point of copy-paste, and tells a reader who does want a reproducible
build to take each version from that package's own npm page — never one version
across both links, since a version a package never published is a hard 404 and
a 404'd stylesheet also renders unstyled with no error.

Gated by `tests/guards/doc-cdn-urls.test.mjs` (offline; runs under
`pnpm test:guards` in the required `Starter` job), which fails on any versioned
`@civitai/*` jsDelivr URL in those four shipped docs. Verified as a regression
test rather than an invariant guard: **red at `72d555a` naming all 7 literals,
green at HEAD.** `CHANGELOG.md`s are deliberately out of scope — they quote
pinned URLs as history, and nobody copy-pastes from a changelog.

Docs-only, but it needs a release: all four files are in their package's `files`
array, so the corrected copy only reaches npm — and the docs generated from it —
on a publish.
