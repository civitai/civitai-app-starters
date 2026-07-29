# @civitai/components-react

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
