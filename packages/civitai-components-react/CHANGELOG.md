# @civitai/components-react

## 0.5.0

### Minor Changes

- 266a021: Three more: `<civitai-button-group>`, `<civitai-input-group>` and
  `<civitai-confirm-dialog>`.

  The two grouping elements are **light DOM**, for a reason worth recording:
  joining controls means reaching their `::part(button)` and `::part(control)`,
  and a part crosses exactly one shadow boundary. From the document those parts
  are reachable; from a shadow root the controls had been slotted into they are
  not. So the grouping element styles children the page owns.

  `<civitai-confirm-dialog>` extends `<civitai-modal>` — the focus trap, the top
  layer and Escape all come from one implementation, and the modal grew two
  render hooks for it. `await dialog.ask()` resolves `true`, `false` on cancel,
  and `false` on a dismissal, so a caller is never left waiting on a promise that
  will not settle. A destructive confirmation lands focus on Cancel.

  The React binding map now follows the superclass chain. That fixed a gap nobody
  had noticed: `<civitai-switch>` extends `<civitai-checkbox>` rather than the
  field base directly, so it had been generated **without** `onChange` or
  `onInvalid` despite dispatching both.

- 266a021: Add `@civitai/components-react/elements` — React bindings for the custom
  elements.

  `ButtonElement`, `TextInputElement` and `SegmentedControlElement` are separate
  from the existing `Button`/`TextInput`/`SegmentedControl`, which keep rendering
  the attribute markup. Nothing an existing consumer imports changes, and the `.`
  entry still reaches neither Lit nor an element module — a test asserts it.

  Props are assigned as properties after mount rather than left to React's own
  prop handling. React decides between attribute and property by whether the
  element has upgraded yet, so an un-upgraded element takes a boolean as the
  string `""` and Lit's converter never runs — `loading` would be truthy but not
  `true`. Assigning directly behaves the same on React 18 and 19, and is the only
  way to pass the segmented control's `data` array at all.

- 266a021: React bindings for all 32 elements, built on `@lit/react`'s `createComponent`
  instead of hand-written wrappers. It derives the props AND their types from the
  element class, forwards refs to the element instance, and always assigns
  properties rather than attributes — which is the React 19 behaviour the previous
  wrappers had to work around by hand.

  Each binding is its own module, so importing `@civitai/components-react/elements/civitai-button`
  reaches that element and nothing else; the `./elements` barrel registers all of
  them and is the convenient-but-larger path.

  Breaking within this unreleased entry point: the wrappers are named after their
  tags (`CivitaiButton`, not `ButtonElement`) and handlers receive the DOM Event
  rather than an extracted value — `onChange={(e) => e.target.value}`,
  `onVote={(e) => e.detail}`.

- 266a021: `<civitai-image>` is bindable: `onImageLoad` and `onImageError`. They are not
  called `onLoad`/`onError` because React wires those itself on any host element,
  so sharing the name would run the handler twice.

  `onSelect` on `CivitaiMenu` is typed with `MenuSelectDetail` now that the event
  carries a value rather than a DOM node.

  Which elements get `onChange`/`onInvalid` is read off the field base rather than
  listed by hand, so a control that joins that base cannot silently miss them —
  which is exactly what happened to the checkbox, radio group and segmented
  control in this release.

- 266a021: Five elements a real consumer needed and the vocabulary had no answer for.

  `<civitai-switch>` **extends** `<civitai-checkbox>` rather than restating it —
  the payoff from folding every control onto one field base last release, since
  the form participation, validity and error chrome all arrive for free and
  `role="switch"` is the only difference that matters.

  `<civitai-progress>` drops `aria-valuenow` entirely when `indeterminate`,
  because a bar that does not know its extent should not claim one.
  `<civitai-pagination>` keeps the first and last page either side of an ellipsis
  so the buttons do not move under the pointer as you page, and emits `change`.
  `<civitai-breadcrumb>` renders its separator as a pseudo-element, which is what
  keeps it out of the trail a screen reader reads.

  `<civitai-table>` is **light DOM on purpose**: a slotted `<tr>` inside a shadow
  `<table>` leaves the table formatting context and stops being a row. It styles a
  table the page already owns, so it works over a data grid's generated markup
  instead of asking anyone to give up sorting and virtualization.

  The CDN bundle budgets move to 32 kB and 38 kB gzip. No element is an outlier
  to shave — an all-in-one bundle simply grows with the vocabulary, and a page
  that counts bytes imports `@civitai/components/<tag>/define` instead.

- 266a021: `<civitai-nav-list>` and `<civitai-nav-item>` — navigation primitives rather
  than an app shell, because the reusable part of a sidebar is the nav tree's
  behaviour and not the chrome around it. Lay the page out with the utilities.

  `current` on the list is an `href`, matched exactly. It marks that item and
  opens every group above it, however deep — the part sidebars usually get
  wrong, landing on a nested route with the section containing it still
  collapsed. An item is a link when it has an `href` and a disclosure when it
  has children; an `href` _with_ children is still a disclosure, never an anchor
  that also toggles. Depth is counted by the item itself, so nesting indents
  without anyone tracking levels in markup.

  Icons stay slotted. The package ships no icon set, so an app brings its own and
  pays for nothing it does not use.

### Patch Changes

- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
  - @civitai/components@0.5.0
  - @civitai/theme@0.4.0

## 0.4.3

### Patch Changes

- bcc24bf: Publish first-party deps as caret ranges instead of exact pins, and stop shipping sourcemaps that cannot resolve their sources (#374, #376).

  **#374 — exact inter-package pins duplicated `@civitai/theme` and `@civitai/components`.**
  `@civitai/components`, `@civitai/components-react` and `@civitai/blocks-react` declared
  their first-party deps as `workspace:*`. pnpm rewrites the workspace protocol at pack
  time, and `*` publishes an **exact** pin — measured off the real tarballs:
  `@civitai/components@0.4.2` shipped `"@civitai/theme": "0.3.1"`, not `"^0.3.1"`.

  Two exact pins from two different releases can never intersect, so co-installing
  adjacent releases produced duplicate physical copies. Measured outside this workspace
  with a real `npm install --package-lock-only` over a closed registry built from the
  actual packed tarballs — an app on `@civitai/components-react@0.4.0` that also pulls
  `@civitai/blocks-react@0.56.1`:

        before   @civitai/theme       0.3.0 (nested) + 0.3.1  — 2 copies
                 @civitai/components  0.4.0 (nested) + 0.4.2  — 2 copies
        after    @civitai/theme       0.3.1                   — 1 copy
                 @civitai/components  0.4.2                   — 1 copy

  That is not only bloat. `injectTokens()` is DOM-marker idempotent and **first copy
  wins**, so the first token bump that changes a _value_ would have shipped stale tokens
  underneath new component CSS — silently, and only in the duplicated install.

  The three manifests now use `workspace:^`, which publishes `^<version>`.

  **Scope of the fix, stated rather than implied.** `^` on a `0.x` version locks the
  minor, so this removes duplication across patch-adjacent releases only. Measured at
  the second point too: an app on `@civitai/components-react@0.3.1` (theme `0.2.1`)
  alongside `@civitai/blocks-react@0.56.1` (theme `0.3.1`) still resolves 2 copies,
  before and after. That is correct and deliberate — a `0.x` minor is a breaking change
  under this repo's own convention, so those two releases genuinely disagree about which
  theme they need, and widening the range to `>=x.y.z <1.0.0` would trade a duplicate
  copy for an incompatible pairing of component CSS with theme tokens.

  One consequence worth knowing at release time: because `^0.3.1` already admits
  `0.3.2`, `changeset version` no longer cascades a re-release of every dependent on a
  theme patch bump (verified against both manifest shapes — with `workspace:*` a theme
  `0.3.1 → 0.3.2` bump dragged `@civitai/components` and `@civitai/components-react` to
  `0.4.3`; with `workspace:^` it leaves them at `0.4.2`).

  **#376 — every shipped sourcemap dangled.**
  All five packages build with `sourceMap` + `declarationMap`, so `dist/` fills with
  `*.js.map` and `*.d.ts.map` whose `sources` point at `../src/*.ts`. No package lists
  `src` in `files`. Measured off the real packed file lists at the previous state: **270
  shipped maps, 270 dangling source references, zero resolvable** — `@civitai/blocks-react`
  160, `@civitai/app-sdk` 46, `@civitai/components-react` 48, `@civitai/theme` 12,
  `@civitai/components` 4. A consumer's devtools loaded each map and then had nothing to
  show.

  The maps are now excluded from the tarballs (`"!dist/**/*.map"`) and still emitted into
  `dist/`, where they are _not_ dangling — inside this repo `src` sits right beside them,
  so go-to-definition from a starter still lands in the real `.ts`. **No consumer
  debuggability is lost, because there was none.** Shipping `src` instead was measured
  and rejected: `packages/civitai-blocks-react/src` alone is 879,895 B, in a package
  whose design constraint is that every app inherits its install graph.

  Tarball delta across the five packages: **−114,574 B gzipped, −580,786 B unpacked**
  (`@civitai/blocks-react` alone: −77,441 B gzipped, −413,492 B unpacked).

  Enforced going forward by `scripts/check-shipped-sourcemaps.mjs` (`pnpm
check:shipped-sourcemaps`), which reads the real packed file list and every real map's
  `sources` rather than grepping for the `files` entry — so shipping `src` or inlining
  `sourcesContent` satisfies it equally.

- Updated dependencies [bcc24bf]
  - @civitai/components@0.4.3
  - @civitai/theme@0.3.2

## 0.4.2

### Patch Changes

- Updated dependencies [e06173f]
  - @civitai/components@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [ee25ac9]
  - @civitai/components@0.4.1
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
- Updated dependencies [393d9a1]
  - @civitai/theme@0.3.0
  - @civitai/components@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [77ce989]
  - @civitai/components@0.3.1
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

### Patch Changes

- Updated dependencies [6b0a2e6]
  - @civitai/components@0.3.0

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

- Updated dependencies [cce1716]
  - @civitai/components@0.2.1

## 0.2.0

### Minor Changes

- b896dd9: Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

  **F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card _without_ `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

  **F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

  **F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.

### Patch Changes

- Updated dependencies [b896dd9]
  - @civitai/theme@0.2.0
  - @civitai/components@0.2.0

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
  - @civitai/components@0.1.2

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
  - @civitai/components@0.1.1
