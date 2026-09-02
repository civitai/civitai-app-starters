# @civitai/theme

## 0.3.0

### Minor Changes

- 73412e3: Ship civitai's responsive breakpoint scale as tokens, and the "am I narrow?" question as a hook.

  Until now a block author had no branch point at all: the pervasive inline-style idiom in blocks has no way to ask about its own width without hand-rolling a `ResizeObserver` and hard-coding numbers. Both halves of that are now provided.

  **`@civitai/theme` — the scale as tokens.**

  - New `--civitai-bp-xs` … `--civitai-bp-xl` CSS custom properties, plus `bpXs`…`bpXl` in the generated `tokens` / `tokenVars` maps and a `bp` group in the DTCG export.
  - New exports `breakpoints` (numbers — the form a JS width comparison actually needs, since a custom property cannot appear in a `@media`/`@container` condition), `BREAKPOINT_KEYS`, `civitaiBreakpointsSource` and the `BreakpointKey` type.

  🔴 **The values are civitai's PX scale, not Mantine's em scale, and the two agree on exactly one key.** `src/utils/breakpoints.json` (mirrored by civitai's Tailwind config and `mantineContainerSizes`) is `xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440`; Mantine's stock em scale — which civitai never overrides and which every Mantine responsive prop uses — is `576 · 768 · 992 · 1200 · 1408`. Only `sm` matches, so a wrong implementation looks right at a glance and a test that pins `sm` alone passes against the wrong scale.

  Because of that, the scale is vendored in its own module (`src/breakpoints.source.ts`) with its own drift guard against `breakpoints.json`, and is emitted through the generator as a **literal** token spec that never touches the Mantine theme pipeline — routing it through `mergeMantineTheme` is precisely how an un-overridden key would silently resolve to the em value. `theme.source.ts` was not the right home: it is a byte-faithful copy of civitai's `createTheme({...})` override, and that override defines no `breakpoints` key at all.

  **`@civitai/blocks-react` — the question as a hook.**

  New `useBlockBreakpoint(ref?)`, plus the pure `resolveBlockTier(width)` and the `BlockBreakpoint` / `BlockSizeTier` types.

  ```tsx
  const bp = useBlockBreakpoint();
  <div
    style={{
      display: "flex",
      flexDirection: bp.below("sm") ? "column" : "row",
    }}
  >
    {bp.atLeast("md") && <aside>…</aside>}
  </div>;
  ```

  - **A container query, not a viewport media query.** It observes an element — by default `document.documentElement`, which inside the block's sandbox iframe _is_ the slot the host handed us. Slot width is not monotonic in viewport width (the `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a 1440px one), so `matchMedia` inside the frame answers a question nobody asked. Same reasoning as the host-side `chromeGeometry.ts`.
  - **Returns a tier, not a width.** `tier` is `'base' | 'xs' | … | 'xl'` with Tailwind semantics (a tier applies at its breakpoint and above); `atLeast(key)` / `below(key)` are the call-site-shaped comparators. A `ResizeObserver` fires on every pixel, so the hook stores the resolved _tier_ and returns a referentially stable object while the tier is unchanged — dragging 200px inside one tier re-renders the block zero times. Exposing the raw width would either force a render per pixel or be a lie, so it is deliberately not returned.
  - `measured` distinguishes "not measured yet" from a genuinely narrow block, since an unmeasured width resolves to `'base'`. SSR-safe: with no `ResizeObserver` the hook never touches the DOM.

## 0.2.1

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

## 0.2.0

### Minor Changes

- b896dd9: Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

  **F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card _without_ `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

  **F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

  **F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.

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
