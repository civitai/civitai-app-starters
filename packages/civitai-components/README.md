# @civitai/components

Attribute-driven, **framework-agnostic** component CSS for civitai App Blocks.
Plain HTML (or any framework) gets civitai-themed components with no build step —
style is selected entirely by `data-civitai-ui="…"` + `data-variant` /
`data-size` attributes, themed by [`@civitai/theme`](../civitai-theme)'s
`--civitai-*` tokens.

For the component list — and each one's required markup, attributes and ARIA
wiring — see [`MARKUP.md`](./MARKUP.md), which ships in this package and is the
source of truth. It is deliberately not duplicated here: this sentence used to
carry a hand-written list, and it silently fell ten components behind.

## Consume

**Zero JS** — link both stylesheets and author plain HTML per
[`MARKUP.md`](./MARKUP.md):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components/styles.css" />

<button data-civitai-ui="button" data-variant="filled" data-size="md">Generate</button>
```

Unversioned on purpose — see the note in [`MARKUP.md`](./MARKUP.md#setup). A
pinned CDN URL keeps returning 200 with an old stylesheet, so newly documented
attributes silently render unstyled.

**From JS** — `injectStyles()` injects both the tokens and the component CSS,
idempotently:

```ts
import { injectStyles } from '@civitai/components';
injectStyles();
```

React authors want [`@civitai/components-react`](../civitai-components-react),
which renders exactly this markup.

### One component's CSS only — not available, on purpose

`componentsCss` / `injectStyles()` / `styles.css` all carry the **whole** sheet.
There is **no supported way to import one component's rules**, and no
`@civitai/components/css/*` subpath: the package declares exactly two exports,
`.` and `./styles.css`.

The build does slice the sheet — `scripts/build-css.ts` writes one standalone,
layered stylesheet per section to `dist/css/<slug>.css` — but nothing in
`exports` names them **and they are excluded from the published tarball**
(`files` carries `"!dist/css"`). They are build inputs for this repo's own
measurement, not an API, and they are not in your `node_modules`. Treat them as
private and unstable; they can be renamed or removed in a patch release.

Why hold a surface whose files are already built: files on disk are reversible,
an `exports` key on a published package is not, and no consumer imports them
today. Opening the surface is cheap later and irreversible now. Not exporting
them was never a reason to *ship* them, either — under an earlier `files:
["dist"]` they added 70 unnameable files to every install.

> 🔴 **`@civitai/blocks-react` deliberately injects the whole pack.**
> [`MARKUP.md`](./MARKUP.md) documents that rendering any one `/ui` component is
> enough to style hand-written `data-civitai-ui="…"` markup elsewhere on the
> page; narrowing it onto slices would take the bytes and break that contract
> silently. Whether to do it anyway — and what, if anything, to export — is
> [issue #358](https://github.com/civitai/civitai-app-starters/issues/358),
> which `pnpm measure:css-split` prices.

**A slice is not self-sufficient, so any future surface must say so.** Slices
are cut along the sheet's `/* ----- Name ----- */` section markers, and the
sheet contains rules that cross those markers. Measured on the current sheet by
sweeping every section for references it does not own (method and counts in the
PR for #358):

| Section | Depends on | Effect of taking the section alone |
|---|---|---|
| `button` | `loader` | `[data-civitai-ui='loader']`'s base rule — width, height, border-width, the `civitai-ui-spin` animation — and the `[data-civitai-ui='button'] [data-civitai-ui='loader'] { color: currentColor }` override both live in the **Loader** section. A loading button renders a **0×0, invisible** loader. Nothing errors. |
| `checkbox` / `radio` | `text-input` | `[data-civitai-ui-label]`'s base typography (14px / 600 / text token) lives in the **TextInput** section; the Checkbox section only overrides `font-weight`/`cursor` on top of it. The label renders in the page's inherited font instead. |

Two is the measured total for the current sheet, not a general guarantee: a
Button-and-Loader pair is what the measurement below actually bundles, and the
right unit for a consumer is the **transitive** component set, never one name.

Measured with esbuild (minify, ESM, React external), a `@civitai/blocks-react/ui`
Button bundle is **52,568 B, of which 50,151 B is stylesheet** — 95.4% CSS for
one component. What the slices would save off that depends on **which** split
you mean, and the two answers are far apart:

| what is split | Button bundle | vs baseline |
|---|---:|---:|
| nothing — shipped today | 52,568 B | 100.0% |
| **`@civitai/components` only** — this package's slices, concatenated | **26,556 B** | **50.5%** |
| **`@civitai/components` only** — merged into one sheet | **25,518 B** | **48.5%** |
| the above *plus* `@civitai/blocks-react` also splitting its own sheet, concatenated | 14,518 B | 27.6% |
| the above *plus* `@civitai/blocks-react` also splitting its own sheet, merged | 13,480 B | 25.6% |

> 🔴 **Only the two middle rows are about this package.** A `blocks-react/ui`
> Button carries CSS from **two** packages: `@civitai/components`' sheet (what
> this package slices) and `@civitai/blocks-react`'s own `INTERACTIVE_STYLES`
> — ~12 KB for Modal, Select, Slider, Collapse, SegmentedControl and
> ResourceCard, which have no `@civitai/components` counterpart. That sheet is
> **not** one of the `dist/css/*.css` artifacts and is **not** touched by this
> split; a Button bundle carries all of it either way. The bottom two rows model
> a **second, unimplemented** split of it in `@civitai/blocks-react`, and the
> **12,038 B** between the two pairs belongs to that hypothetical change, not to
> this one.

Reproduce with `pnpm measure:css-split` from the repo root; run it with
`MEASURE_CARRIERS=1` to see, per row, how many bytes of each package's sheet
the row actually removed (expected: `interactive: removed 0 B` on the rows
labelled `[SHIPPED]`).

The split is asserted **byte-identical on reassembly** before anything is
written (`scripts/slice-css.ts`, guarded with its negative control in
`test/css-slice.test.ts`). That assertion proves the **partition arithmetic** —
that the pieces `sliceComponentsCss` hands back, recomposed by `composeSheet`,
are exactly the input sheet. It does **not** prove that the sheet was cut in the
right places: a section marker the slicer fails to recognise merges into the
previous slice and never gets its own `.css`, and reassembly is still perfect.
A separate boundary guard counts the raw `/* ----- ` markers in the sheet and
pins that count against the number of sections, which is what catches that.

The component vocabulary is derived from the `data-civitai-ui` selectors each
section contains — a test pins that set equal to `COMPONENT_NAMES` in both
directions.

## Design

- All rules live in `@layer civitai.components`, so consumer CSS wins the
  cascade without specificity fights.
- State colors (hover/active/tint) are derived with `color-mix()` from base
  tokens — no shade enumeration.
- Authored in plain CSS with native nesting (no preprocessor); `src/components.css`
  is the single source of truth (copied to `dist/components.css`, embedded as
  the injectable string, and sliced per component — all three guarded by parity
  tests, the slicing additionally by a byte-identical-reassembly assertion).

## Markup contract

Styling is selected entirely by `data-*` attributes; any HTML that follows the
contract below renders identically to the React bindings. **`legend`:** _bold_ =
required for correct styling + a11y. [`MARKUP.md`](./MARKUP.md) is the canonical
source (with per-component examples + a11y wiring) and the executable contract
the `html-vs-react-parity` browser test enforces; the essentials are inlined
here so they're readable on the npm package page.

**Theming** — set `data-theme="light"` or `data-theme="dark"` on any ancestor
(typically `<html>` or the block root); tokens re-resolve from that scope
(default = light). **Cascade** — every rule lives in `@layer civitai.components`,
so your own unlayered CSS always wins with no `!important`; override a token
locally by redeclaring it (`style="--civitai-color-primary: #a259ff"`).

### Button — `data-civitai-ui="button"`
- Element: **`<button>`** (or `<a role="button">`).
- `data-variant`: `filled` (default) · `light` · `outline` · `subtle`
- `data-size`: `sm` · `md` (default) · `lg` · `data-full-width="true"`.
- Loading: **`aria-busy="true"` + `disabled`**, first child
  `<span data-civitai-ui="loader" data-size="sm" aria-hidden="true"></span>`.
- Icon slots: `<span data-civitai-ui-section="left|right">`. Icon-only ⇒ `aria-label`.

### TextInput — `data-civitai-ui="text-input"`
Wrapper **`<div data-civitai-ui="text-input">`** containing, in order:
**`<label data-civitai-ui-label for="ID">`** (+ optional
`<span data-civitai-ui-required aria-hidden="true">*</span>`), optional
`<span id="ID-desc" data-civitai-ui-description>`, **`<input data-civitai-ui-control id="ID">`**,
optional `<span id="ID-err" data-civitai-ui-error role="alert">`. When invalid:
`aria-invalid="true"` on the control + `data-invalid="true"` on the wrapper, and
`aria-describedby="ID-desc ID-err"`.

- **Textarea** — `data-civitai-ui="textarea"`; control is **`<textarea data-civitai-ui-control>`**.
- **NumberInput** — `data-civitai-ui="number-input"`; control is **`<input type="number" data-civitai-ui-control>`**.

### Card — `data-civitai-ui="card"`
`data-with-border="true"` · `data-padding`: `sm` · `md` · `lg`. Presentational
container (`<div>`/`<section>`/`<article>`).

### Stack / Group — `data-civitai-ui="stack" | "group"`
Vertical (Stack) / horizontal center-aligned (Group) flex. `data-gap`: `sm` · `md` · `lg`.

### Alert — `data-civitai-ui="alert"`
**`role="alert"`** (or `role="status"`). `data-color`: `info` (default) ·
`success` · `warning` · `error`. Structure: optional icon, then
**`<div data-civitai-ui-alert-body>`** with optional
`<div data-civitai-ui-alert-title>` + the message; optional
`<button data-civitai-ui-alert-close aria-label="Dismiss">×</button>`.

### Loader — `data-civitai-ui="loader"`
`data-size`: `sm` · `md` (default) · `lg`. Decorative inside a button ⇒
`aria-hidden="true"`; standalone ⇒ `role="status"` + accessible label.

### Badge — `data-civitai-ui="badge"`
`data-variant`: `filled` (default) · `light` · `outline`. `data-size`: `sm` ·
`md` (default) · `lg`. `data-color` (optional): `info` · `success` · `warning` ·
`error` (mirrors Alert; omit for the default primary accent). Presentational
`<span>`; add `aria-label` if it conveys status.

## Demo

`demo/index.html` (shipped in the package) is a **complete, copy-paste
plain-HTML page** — the two CDN `<link>` tags, one of every component, a
light/dark `data-theme` toggle, and page theming via `var(--civitai-color-body)`.
Open it directly in a browser (it loads the CSS from jsDelivr, zero build step),
or copy it as the starting point for a no-framework block.
