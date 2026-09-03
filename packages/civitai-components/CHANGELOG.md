# @civitai/components

## 0.4.1

### Patch Changes

- ee25ac9: Docs: drop the version from the copy-paste CDN `<link>` URLs, so the stylesheet
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
  being wrong. Unversioned can only be _ahead_ of the docs — additive, so
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

- Updated dependencies [ee25ac9]
  - @civitai/theme@0.3.1

## 0.4.0

### Minor Changes

- 393d9a1: Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

  ⚠️ **Upgrading — one visible layout change.** A `group` row now **wraps** instead of overflowing, and its children may shrink. If you relied on a group staying on one line — a deliberately horizontal-scrolling toolbar, for example — add `data-nowrap="true"` to restore the previous behaviour:

  ```html
  <div data-civitai-ui="group" data-nowrap="true">…</div>
  ```

  This affects bare markup and `@civitai/components-react`'s `<Group>`. `@civitai/blocks-react`'s `<Group>` is unchanged — it already wrapped.

  **`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

  There are **three** `group` surfaces, and they did not agree:

  - `@civitai/blocks-react`'s `<Group>` defaults `wrap = true` and writes `flex-wrap` as an _inline_ style — its consumers have always wrapped;
  - `@civitai/components-react`'s `<Group>` writes no inline style at all and has no `wrap` prop, so it resolved against the CSS;
  - bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve — likewise.

  The CSS carried no `flex-wrap`, so the latter two did not wrap. Nothing could see it, because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 320px box**. They now reflow onto two rows and fit, and a test pins the CSS default against the rendered React default so they cannot drift apart again.

  **Be precise about what this is:** for `blocks-react` it aligns the CSS to a default that was already shipping, but for `@civitai/components-react` and for bare markup it is a genuinely **new default**.

  `min-width: 0` lets one long unbroken label narrow instead of pushing the whole row past its container. It applies to a child with the default `overflow: visible`; per CSS Flexbox §4.5 a child with any other `overflow` already has an automatic minimum size of 0.

  **`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

  Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

  ***

  **Bump level: `minor`, decided — not an open question.**

  An adversarial audit recommended `major` for `@civitai/components`, on the grounds that `RELEASING.md` reserves it for "a behavior change that existing callers will notice" and this change is justified precisely by the fact that they do notice (436px of overflow becomes two rows). That reading is sound; it was considered and **the maintainer chose `minor`**, since publishing `@civitai/components@1.0.0` off `0.3.1` is a product decision rather than a correctness one.

  Recorded so a later reader knows this was weighed rather than missed, and so the trade-off is visible: shipping as `minor` means **this changelog entry is the only warning consumers get**, which is why the upgrade note is at the top rather than buried here. The concrete case it exists for is a published App Block rendering bare `data-civitai-ui="group"` as a deliberately horizontal-scrolling toolbar — that starts wrapping, and `data-nowrap="true"` is the one-attribute fix.

### Patch Changes

- Updated dependencies [73412e3]
  - @civitai/theme@0.3.0

## 0.3.1

### Patch Changes

- 77ce989: Refresh the stale CDN version pins in the shipped docs (`MARKUP.md`, both
  `README.md`s, `demo/index.html`) to the currently-published versions —
  `@civitai/theme@0.2.0` and `@civitai/components@0.3.0`.

  Both links were still pinned at `@0.1.1` (published 2026-07-22), two minors
  behind `components@0.3.0` (2026-07-29) and one behind `theme@0.2.0`
  (2026-07-23). That URL still resolves — jsDelivr serves every published version
  forever — so this never surfaced as a broken link. It silently served an old
  stylesheet: `components@0.1.1/styles.css` is 8,713 B and carries rules for **10**
  distinct `data-civitai-ui` values; `@0.3.0` is 28,042 B and carries **20**.

  `MARKUP.md` documents 19 component sections. So an external HTML author
  following the markup contract verbatim wrote correct, contract-shaped markup for
  `checkbox`, `image`, `radio`, `radio-group`, `segmented-control`, `select`,
  `slider`, `toast`, `toast-region` and `tooltip` against CSS that has no rules for
  any of them — they render as unstyled bare elements, with no console error and no
  failed request to notice. The theme pin was stale the same way: 17 `--civitai-*`
  tokens at `0.1.1` vs 27 at `0.2.0`, so every token added since resolved to
  nothing.

  **These packages version INDEPENDENTLY — there is no shared version number.**
  `@civitai/theme` has never published a `0.3.0`. Applying one version across both
  links (the obvious-looking "bump them all to 0.3.0" fix) produces
  `…/@civitai/theme@0.3.0/styles.css`, which is a hard 404 — and a stylesheet that
  404s renders an unstyled page with no error either, so the wrong fix fails the
  same silent way as the stale pin it replaces. `demo/index.html`'s comment now
  says so at the point of copy-paste.

  Every URL written here was verified to return 200 before commit, with the check
  first validated against known-bad inputs (`theme@0.3.0` and `components@0.9.9`
  both correctly reported 404).

  Docs-only, but it needs a release: `MARKUP.md`, `README.md` and `demo/` are all
  in `@civitai/components`'s `files`, and `README.md` is in `@civitai/theme`'s, so
  the corrected copy only reaches npm — and the docs generated from it — on a
  publish.

- Updated dependencies [77ce989]
  - @civitai/theme@0.2.1

## 0.3.0

### Minor Changes

- 6b0a2e6: Add five new UI primitives so App Blocks stop hand-rolling them: **Slider**,
  **SegmentedControl / Tabs**, **Toast**, **Tooltip**, and **Image**.

  Each ships in both consumption forms — framework-agnostic
  `data-civitai-ui="…"` markup (styled by `@civitai/components`, contract in
  `MARKUP.md`, all rules inside `@layer civitai.components`, token-driven via
  `--civitai-*`) and an ergonomic `forwardRef` React binding in
  `@civitai/components-react`. The interactive ones carry real behavior in the
  React binding:

  - **Slider** (`data-civitai-ui="slider"`) — themed native `<input type="range">`
    with label/description/error field wiring, invalid state, and an optional live
    value read-out (also mirrored to `aria-valuetext` for screen readers).
  - **SegmentedControl / Tabs** (`data-civitai-ui="segmented-control"` +
    `TabPanel`) — WAI-ARIA **roving tabindex** + **arrow-key / Home / End
    navigation** (selection follows focus) in two role modes: `'toggle'` (default)
    = `role="radiogroup"`/`role="radio"` for a panel-less value switch, and
    `'tabs'` = `role="tablist"`/`role="tab"` with `aria-controls` ⇄
    `aria-labelledby` tab-panel semantics.
  - **Toast** (`ToastProvider` + `useToast`, presentational `Toast`,
    `data-civitai-ui="toast-region"`) — an `aria-live` notification host with a
    queue, auto-dismiss timers, and intent colors.
  - **Tooltip** (`data-civitai-ui="tooltip"`) — a hover/focus `role="tooltip"`
    bubble with `aria-describedby` wiring and real Escape-to-dismiss (a
    `data-dismissed` flag overrides the CSS reveal even while hovered/focused).
  - **Image** (`data-civitai-ui="image"`) — a media container with a token
    placeholder background, `object-fit` control, and broken-image fallback
    driven by `data-status`.

  Covered by probe-oracle styling anchors, HTML⇄React computed-style parity, and
  axe a11y checks (keyboard nav for SegmentedControl, `aria-live` for Toast).

## 0.2.1

### Patch Changes

- cce1716: Patch release (0.2.1) — implement the documented component defaults in the base CSS.

  `MARKUP.md` documents a default `data-variant` / `data-size` / `data-color` for several components, but `@civitai/components` gated **all** of that styling on an **explicit** attribute — so a bare element (including MARKUP's own minimal examples) rendered unstyled or zero-size. This was a doc-vs-code mismatch: the docs were correct; the CSS did not match them.

  The documented defaults now live on the unconditional **base** rule, so bare markup (`<span data-civitai-ui="badge">`, `<button data-civitai-ui="button">`, a bare alert / loader) renders the documented default; the explicit `data-variant` / `data-size` / `data-color` rules still **override**.

  **Components that had the gap (now fixed):**

  - **Badge** — no default variant (`filled`) or size (`md`): a bare badge had no padding and no fill. Now renders filled + md.
  - **Button** — no default size (`md`): a bare button had no height/padding. The base filled default is also completed (`border-color` + hover).
  - **Alert** — no default color (`info`): a bare alert rendered neutral chrome instead of the documented info intent (tinted bg + border). Now renders the info intent.
  - **Loader** — no default size (`md`): a bare loader was `0×0` (invisible). Now renders the 22px md spinner.

  Badge's `light` variant now resets `border-color: transparent` explicitly (it previously relied on the base transparent border, which the fix changes to primary) — light badges are visually unchanged. **No documented default was changed** — the CSS was made to match the docs, not vice versa.

  The `@civitai/components-react` bindings are behaviorally unchanged (they already emit explicit attributes; the CSS defaults benefit hand-written HTML consumers) and get the patch as the lockstep React binding of `@civitai/components`.

## 0.2.0

### Minor Changes

- b896dd9: Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

  **F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card _without_ `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

  **F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

  **F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.

### Patch Changes

- Updated dependencies [b896dd9]
  - @civitai/theme@0.2.0

## 0.1.2

### Patch Changes

- 5a210cb: Design-system 0.1.2 — two retrofit-dogfood fixes (civitai/civitai-app-starters#181).

  - **Badge `data-color` (F2):** Badge now accepts an intent color mirroring
    Alert's `data-color` contract (`info` / `success` / `warning` / `error`),
    recoloring the `filled` / `light` / `outline` variants via the same
    `color-mix()` token approach. `@civitai/components-react` `<Badge>` gains a
    `color` prop mapped to `data-color`. Omitting it keeps the current primary
    accent, so the change is non-breaking.
  - **Dark `--civitai-color-primary-fg` (F8):** the generated
    `[data-theme='dark']` token block now emits `--civitai-color-primary-fg`
    (white) for symmetry with light. It is produced by the `@civitai/theme` token
    pipeline (not hand-authored), so generation-parity holds; light is unchanged.

- Updated dependencies [5a210cb]
  - @civitai/theme@0.1.2

## 0.1.1

### Patch Changes

- b61eb57: Fix design-system onboarding papercuts found by a blind dogfood (lockstep 0.1.1).

  - **CDN styles.css now resolves on any CDN.** `@civitai/theme` and
    `@civitai/components` ship a real package-root `styles.css` file (built from
    `dist/`), so a literal path like
    `cdn.jsdelivr.net/npm/@civitai/theme@0.1.1/styles.css` resolves — jsDelivr
    ignores package.json `exports`, so the `./styles.css` export alias alone 404'd
    there. The `exports` alias still works for bundler imports.
  - **Docs CDN URLs fixed** — every README + `MARKUP.md` now uses pinned,
    resolvable jsDelivr URLs.
  - **Markup contract inlined** into the `@civitai/components` README (the
    relative `MARKUP.md` link 404'd on npmjs.com); `MARKUP.md` stays canonical.
  - **Servable `demo/index.html`** now ships in the `@civitai/components` tarball —
    a complete copy-paste plain-HTML page (CDN links, one of every component, a
    light/dark `data-theme` toggle, page theming via `--civitai-color-body`).
  - **New `--civitai-color-body` token** in `@civitai/theme` (derived from
    Mantine's `--mantine-color-body`: `#fefefe` light / `#1A1B1E` dark) — a
    page-background token for plain-HTML apps.

- Updated dependencies [b61eb57]
  - @civitai/theme@0.1.1
