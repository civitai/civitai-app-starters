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

## Elements

The same components as **custom elements**, so behaviour ships with the style
instead of being reimplemented per framework. They render in a shadow root and
read the same `--civitai-*` tokens, which inherit across the boundary.

```ts
import '@civitai/components/register';               // every element
import '@civitai/components/civitai-button/define';  // just this one
```

```html
<civitai-button variant="filled" size="md">Generate</civitai-button>
<civitai-text-input label="Prompt" name="prompt"></civitai-text-input>
<civitai-segmented-control aria-label="View"></civitai-segmented-control>
```

One script tag, no build:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@civitai/components/elements.js"></script>
```

`elements.js` is a self-contained bundle at the package root, because jsDelivr
ignores `exports` — the same reason `styles.css` is copied there. The build
fails if it exceeds **25 kB gzip**; it currently sits at about 11 kB.

[`custom-elements.json`](./custom-elements.json) is the published contract —
every tag, attribute, property, `::part` and slot. It is generated from the
element sources (tags from `defineElement(TAG, …)`, parts and slots from the
templates), so nothing is restated in JSDoc and nothing can drift. A test fails
if it stops matching what the package registers.

The attribute CSS above keeps shipping unchanged at the same path, so nothing
has to migrate. The `.` entry still carries no renderer — importing
`injectStyles()` does not pull Lit in, and a test asserts it.

Elements set their own tokens up: the first one to connect calls
`injectTokens()` on its document, so a single `<script type="module">` is
enough on a bare page.

| | |
|---|---|
| Attributes | mirror the props, kebab-cased (`full-width`) |
| Properties | `el.variant = 'outline'` — identical result to the attribute |
| Styling hooks | `::part(button)`, plus every `--civitai-*` token |
| Forms | form-associated: `FormData`, `form.reset()`, `type="submit"`/`type="reset"` and Enter-to-submit all work, which controls inside a shadow root otherwise lose |
| Events | `change` is re-dispatched across the boundary (it is `composed: false`, so it would never escape) |

`<civitai-segmented-control>` takes its segments as a property, since they are
structured data:

```ts
document.querySelector('civitai-segmented-control').data = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];
```

It implements the roving tabindex `MARKUP.md` currently asks hand-HTML authors
to write themselves: one tab stop, arrows wrapping across enabled segments,
Home/End, and selection following focus.

`error` on a field also makes it **invalid**, so the form will not submit while
the message shows — unlike the React binding, which draws the message but leaves
`checkValidity()` true despite setting `aria-invalid`.

### Working on them

```bash
pnpm --filter @civitai/components dev           # playground, HMR from src/
pnpm --filter @civitai/components test:browser  # element behaviour + parity
```

The playground imports the elements from `src/`, so an edit is on screen
without a build. `demo/` is the opposite: it loads the published artifact from
jsDelivr to verify what consumers actually get.

## Design

- All rules live in `@layer civitai.components`, so consumer CSS wins the
  cascade without specificity fights.
- State colors (hover/active/tint) are derived with `color-mix()` from base
  tokens — no shade enumeration.
- Authored in plain CSS with native nesting (no preprocessor); `src/components.css`
  is the single source of truth (copied to `dist/components.css` and embedded as
  the injectable string, guarded by a parity test).

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
