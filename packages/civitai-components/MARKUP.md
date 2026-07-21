# `@civitai/components` — markup contract

These components are **framework-agnostic**: the styling is driven entirely by
`data-*` attributes, so any HTML that follows the contract below renders
identically to the React bindings in `@civitai/components-react`. This document
is the source of truth for external HTML authors.

## Setup

Load the tokens **and** the component CSS (order-independent, but load both):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components/styles.css" />
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

### Card — `data-civitai-ui="card"`
- `data-with-border="true"` — add a border.
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
- Presentational `<span>`. If it conveys status, add an `aria-label`.

---

## React parity

`@civitai/components-react` renders exactly this markup. The
`html-vs-react-parity` browser test asserts `getComputedStyle()` is identical
between hand-written HTML (per this doc) and the React components, in both
themes — so this contract is executable, not aspirational.
