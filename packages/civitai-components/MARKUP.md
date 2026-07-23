# `@civitai/components` — markup contract

These components are **framework-agnostic**: the styling is driven entirely by
`data-*` attributes, so any HTML that follows the contract below renders
identically to the React bindings in `@civitai/components-react`. This document
is the source of truth for external HTML authors.

## Setup

Load the tokens **and** the component CSS (order-independent, but load both):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme@0.1.1/styles.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components@0.1.1/styles.css" />
```

Or, from JS: `import { injectStyles } from '@civitai/components'; injectStyles();`
(injects both tokens and component CSS, idempotently).

## Theming

Set `data-theme="light"` or `data-theme="dark"` on any ancestor (typically
`<html>` or the block root). All tokens re-resolve from that scope. Default
(no attribute) is the light palette.

## Cascade / overriding

Every shipped rule lives in `@layer civitai.components`. Your own **unlayered**
CSS always beats it — no `!important`, no specificity war. Override a token
locally by redeclaring the custom property (e.g.
`style="--civitai-color-primary: #a259ff"`).

---

## Components

Legend: **bold** = required attribute/element for correct styling + a11y.

### Button — `data-civitai-ui="button"`
- Element: **`<button>`** (or `<a role="button">` for links).
- `data-variant`: `filled` (default) · `light` · `outline` · `subtle`
- `data-size`: `sm` · `md` (default) · `lg`
- `data-full-width="true"` — stretch to container width.
- Loading: set **`aria-busy="true"`** and **`disabled`**; place a
  `<span data-civitai-ui="loader" data-size="sm" aria-hidden="true"></span>`
  as the first child.
- Icon slots: `<span data-civitai-ui-section="left|right">…</span>`.
- A11y: native `<button>` gives role/focus/keyboard for free. Icon-only buttons
  MUST have an `aria-label`.

```html
<button data-civitai-ui="button" data-variant="filled" data-size="md">Generate</button>
```

### TextInput — `data-civitai-ui="text-input"`
- Wrapper **`<div data-civitai-ui="text-input">`** containing, in order:
  - **`<label data-civitai-ui-label for="ID">`** (+ optional
    `<span data-civitai-ui-required aria-hidden="true">*</span>`)
  - optional `<span id="ID-desc" data-civitai-ui-description>`
  - **`<input data-civitai-ui-control id="ID">`**
  - optional `<span id="ID-err" data-civitai-ui-error role="alert">`
- Wire a11y: input `aria-describedby="ID-desc ID-err"`, and when invalid
  `aria-invalid="true"` + `data-invalid="true"` on the wrapper.

```html
<div data-civitai-ui="text-input">
  <label data-civitai-ui-label for="name">Name</label>
  <input data-civitai-ui-control id="name" />
</div>
```

### Textarea — `data-civitai-ui="textarea"`
Identical to TextInput but the control is **`<textarea data-civitai-ui-control>`**
(resizable vertically).

### NumberInput — `data-civitai-ui="number-input"`
Identical to TextInput; the control is **`<input type="number" data-civitai-ui-control>`**.

### Select — `data-civitai-ui="select"`
Identical field chrome to TextInput; the control is a native
**`<select data-civitai-ui-control>`** (native disclosure caret retained). Wire
a11y exactly like TextInput (label `for`, `aria-describedby`, `aria-invalid` +
`data-invalid` when invalid). This is the framework-agnostic NATIVE select — not
the interactive JS Select from `@civitai/blocks-react`.

```html
<div data-civitai-ui="select">
  <label data-civitai-ui-label for="model">Model</label>
  <select data-civitai-ui-control id="model">
    <option value="sdxl">SDXL</option>
    <option value="flux">Flux</option>
  </select>
</div>
```

### Checkbox — `data-civitai-ui="checkbox"`
A themed native checkbox: the box and its label sit inline in a `-choice` row,
with description/error below. `accent-color` carries the theme tint.
- Wrapper **`<div data-civitai-ui="checkbox">`** containing, in order:
  - **`<div data-civitai-ui-choice>`** wrapping:
    - **`<input type="checkbox" id="ID">`** — the checkbox itself. The bare
      `type="checkbox"` inside the wrapper is what the CSS targets; do **not**
      put `data-civitai-ui-control` on it (that is the full-width field-input
      chrome for text/select controls).
    - **`<label data-civitai-ui-label for="ID">`** (+ optional
      `<span data-civitai-ui-required aria-hidden="true">*</span>`)
  - optional `<span id="ID-desc" data-civitai-ui-description>`
  - optional `<span id="ID-err" data-civitai-ui-error role="alert">`
- Wire a11y: input `aria-describedby="ID-desc ID-err"`, and when invalid
  `aria-invalid="true"` + `data-invalid="true"` on the wrapper.
- Disabled / checked / indeterminate are the native input states.

```html
<div data-civitai-ui="checkbox">
  <div data-civitai-ui-choice>
    <input type="checkbox" id="tos" />
    <label data-civitai-ui-label for="tos">I agree</label>
  </div>
</div>
```

### Radio — `data-civitai-ui="radio"`
Identical to Checkbox but the control is **`<input type="radio" id="ID">`**.
Group several by giving them the same **`name`**. Wrap a set in a RadioGroup
(below) for the `role=radiogroup` layout + group label.

### RadioGroup — `data-civitai-ui="radio-group"`
- **`role="radiogroup"`** on the wrapper.
- Optional group label: **`<span data-civitai-ui-label id="GID">`** referenced by
  the wrapper's **`aria-labelledby="GID"`** (+ optional description linked via
  `aria-describedby`).
- Options container: **`<div data-civitai-ui-radio-options>`** holding the
  `data-civitai-ui="radio"` items. `data-orientation="horizontal"` lays them out
  in a row (default is a vertical stack).
- Optional **group-level** error (mirrors the field components): a
  **`<span id="GID-err" data-civitai-ui-error role="alert">`** *after* the
  options container. When present, wire a11y on the **wrapper**:
  `aria-invalid="true"` + `data-invalid="true"`, and join the error id into the
  wrapper's `aria-describedby="GID-desc GID-err"` (alongside the description id).
  With no error, emit none of these attributes (backward-compatible).

```html
<div data-civitai-ui="radio-group" role="radiogroup" aria-labelledby="sampler-lbl">
  <span data-civitai-ui-label id="sampler-lbl">Sampler</span>
  <div data-civitai-ui-radio-options>
    <div data-civitai-ui="radio"><div data-civitai-ui-choice>
      <input type="radio" name="sampler" id="s-euler" />
      <label data-civitai-ui-label for="s-euler">Euler</label>
    </div></div>
    <div data-civitai-ui="radio"><div data-civitai-ui-choice>
      <input type="radio" name="sampler" id="s-ddim" />
      <label data-civitai-ui-label for="s-ddim">DDIM</label>
    </div></div>
  </div>
</div>
```

### Card — `data-civitai-ui="card"`
- A card has a **subtle default hairline** in light mode (where `surface` ==
  `body`, an otherwise-borderless card would be invisible). Dark differentiates
  `surface` from `body`, so no default hairline is drawn there.
- `data-with-border="true"` — the stronger, fully-opaque explicit border.
- `data-padding`: `sm` · `md` · `lg`.
- A11y: use a landmark/heading inside as appropriate; the card itself is a
  presentational container (`<div>`/`<section>`/`<article>`).

### Stack — `data-civitai-ui="stack"`
Vertical flex. `data-gap`: `sm` · `md` · `lg` (default ~12px). Presentational
`<div>`.

### Group — `data-civitai-ui="group"`
Horizontal flex, items center-aligned. `data-gap`: `sm` · `md` · `lg`.

### Alert — `data-civitai-ui="alert"`
- **`role="alert"`** (or `role="status"` for non-urgent).
- `data-color`: `info` (default intent) · `success` · `warning` · `error`.
- Structure: optional icon, then
  **`<div data-civitai-ui-alert-body>`** with an optional
  `<div data-civitai-ui-alert-title>` and the message. Optional dismiss:
  `<button data-civitai-ui-alert-close aria-label="Dismiss">×</button>`.

```html
<div data-civitai-ui="alert" data-color="success" role="alert">
  <div data-civitai-ui-alert-body>
    <div data-civitai-ui-alert-title>Saved</div>
    Your changes are live.
  </div>
</div>
```

### Loader — `data-civitai-ui="loader"`
- `data-size`: `sm` · `md` (default) · `lg`.
- A11y: decorative inside a button → `aria-hidden="true"`. Standalone busy
  indicator → wrap/annotate with `role="status"` + an accessible label
  (e.g. visually-hidden "Loading").

### Badge — `data-civitai-ui="badge"`
- `data-variant`: `filled` (default) · `light` · `outline`.
- `data-size`: `sm` · `md` (default) · `lg`.
- `data-color` (optional): `info` · `success` · `warning` · `error` — the same
  intent set as Alert. Omit it for the default primary accent. Recolors the
  `filled` / `light` / `outline` variants.
- Presentational `<span>`. If it conveys status, add an `aria-label`.

```html
<span data-civitai-ui="badge" data-variant="light" data-color="success" data-size="md">ready</span>
```

---

## React parity

`@civitai/components-react` renders exactly this markup. The
`html-vs-react-parity` browser test asserts `getComputedStyle()` is identical
between hand-written HTML (per this doc) and the React components, in both
themes — so this contract is executable, not aspirational.
