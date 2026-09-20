# @civitai/elements

Light-DOM custom elements for Civitai apps, built on [Lit](https://lit.dev) 3.
Framework-agnostic, per-component CSS, form-associated inputs, themed by
[`@civitai/theme`](../civitai-theme).

**Phase 1 / foundation spike.** Four components — `civitai-button`,
`civitai-stack`, `civitai-select`, `civitai-slider` — chosen because between
them they cover every hard case in the design: a wrapper with arbitrary
children, a pure layout primitive, a composite form-associated control, and a
form-associated control with a range value. This is not yet a component
library; it is the architecture, proven.

---

## Why this package exists

`@civitai/blocks-react/ui` and `@civitai/components-react` publish **34
identical component names with drifted contracts**. Measured:

| Component | `blocks-react/ui` | `components-react` | Consequence |
|---|---|---|---|
| `Select` | controlled (`value` + `onChange` required) | uncontrolled native `<select>` with `<option>` children | not interchangeable in either direction |
| `Stack` `gap` | `string \| number` → `style.gap` | `'sm' \| 'md' \| 'lg'` → `data-gap` | `gap="md"` emits `style="gap: md"` — invalid CSS, silently dropped |
| `Alert` `role` | derived from colour | always `alert` | an `info` alert interrupts a screen reader |
| `SegmentedControl` | `tablist` / `tab` | `radiogroup` / `radio` | two different a11y contracts |
| `Slider` `required` | forwarded to a range input (where it can never fire) | documented on the shared field props, forwarded nowhere | a promise no code keeps |

Fleet usage across 33 app repos: `blocks-react/ui` in 147 files,
`components-react` in 32 — and **five of six apps import both**. That is the
hazard: the same name, in the same file tree, meaning two different things.

The second reason is bundle cost. Importing **one** `/ui` `Button` costs
**52,571 B** minified, of which ~50.5 KB is stylesheet text held in
`export const` strings that no bundler can split.

---

## Measured result

`node scripts/measure-bundle.mjs` (esbuild, minified, ESM, React external):

| scenario | minified | gzip | vs baseline |
|---|---|---|---|
| `blocks-react/ui` Button (**baseline**) | 52,568 B | 12,478 B | 100% |
| `components-react` Button | 51,765 B | 12,668 B | 98.5% |
| **`@civitai/elements/button`** | **21,309 B** | **6,247 B** | **40.5%** |
| `elements/button` + `elements/stack` | 23,735 B | 6,946 B | 45.2% |
| all four elements (barrel import) | 42,411 B | 12,544 B | 80.7% |
| `blocks-react/ui` all (barrel import) | 121,738 B | 33,244 B | 231.6% |

A one-Button page drops **59.5%** of its bytes (50% gzipped), and **all four
elements together still cost less than one Button does today**.

Where the 21,309 B goes:

| | bytes |
|---|---|
| `@lit/reactive-element` runtime | 6,833 |
| `@civitai/theme` token sheet | 5,984 |
| Button's own CSS | 4,330 |
| Button element code | 2,268 |
| style adoption + base class + define | 1,234 |

`lit-html` is **not in that list**, and that is not an accident — see
constraint (a).

Three honest caveats.

1. The absolute numbers depend on esbuild's settings; only the ratios between
   rows are meaningful, and every row is bundled identically.
2. The shape of the curve differs. The React packages pay ~52 KB for the first
   component and ~0 for each of the next 33; this package pays ~13 KB of shared
   runtime plus ~1–4 KB per component. The crossover is somewhere around a dozen
   components, so an app importing the *entire* library would not win on size —
   but no measured app does, and the ones importing a handful win large.
3. **The last row got worse, and that is the strangler's transitional cost.**
   It was 110,772 B before this change; `blocks-react/ui`'s barrel now drags
   `@civitai/elements` as well, because `Stack` renders `<civitai-stack>`. Any
   app importing the whole `/ui` barrel pays for both design systems until the
   migration finishes. Apps importing named components pay only for the ones
   they use, and this is the expected shape of a strangler — the number comes
   back down as seams land, not before.

---

## The two constraints the design is built around

### (a) Light DOM has no `<slot>`

`<slot>` is a shadow-DOM feature. These elements render into the light DOM, so
there is nowhere to project children. A component that templates its own
children would **replace** whatever the consumer put inside.

The answer is a split enforced by the class hierarchy:

- **Wrappers are enhance-only.** `civitai-button` and `civitai-stack` extend
  `ReactiveElement`, which has no templating layer at all — no `render()`, no
  `lit-html` anywhere in the module graph. They set attributes, custom
  properties and ARIA on *themselves* and never write a child node. Even the
  Button's loading spinner is a `::before` pseudo-element rather than a
  `<civitai-loader>` child.
- **Leaves own their content.** `civitai-select` and `civitai-slider` take
  content via properties (`options`, `label`, `description`, `error`) and
  render it with Lit.

This is structural, not a convention: adding a `render()` to a wrapper means
changing its base class, which puts `lit` in the graph and fails
`test/enhance-only.test.ts`.

### (b) A form-associated element that also renders a *named* native control double-submits

A form-associated custom element contributes its value through
`ElementInternals.setFormValue()`. It does **not** hide its descendants from
the form owner — so a nested `<select name="sampler">` is *also* a listed,
named, form-owned element and contributes a second entry under the same key.

**The host owns `name`; the inner native control never has one.** The inner
control still exists, because that is where the combobox semantics, keyboard
handling, type-ahead and native popup come from — only its `name` is removed.

Pinned by `test/form-participation.browser.test.ts`, which submits a real
`<form>` and asserts three separate things: the value, the *cardinality*
(`fd.getAll(name).length === 1` — the assertion that actually catches a
duplicate), and a structural ledger that no descendant carries `name` at all.

---

## Usage

```bash
pnpm add @civitai/elements
```

```js
// Import only what you use — this is the bundle story.
import '@civitai/elements/button';
import '@civitai/elements/select';
```

```html
<civitai-stack gap="lg">
  <civitai-select id="sampler" name="sampler" label="Sampler" required></civitai-select>
  <civitai-slider name="cfg" label="CFG" min="1" max="20" show-value></civitai-slider>
  <civitai-button variant="filled">Generate</civitai-button>
</civitai-stack>

<script type="module">
  document.getElementById('sampler').options = [
    { value: 'euler', label: 'Euler' },
    { value: 'dpmpp2m', label: 'DPM++ 2M' },
  ];
</script>
```

Styling is automatic: each element adopts its own stylesheet and the
`--civitai-*` tokens on first upgrade. For a zero-JS page, link
`@civitai/elements/styles.css` and `@civitai/theme/styles.css` instead.

**React consumers**: see [`@civitai/elements-react`](../civitai-elements-react).
No wrapper components — typed JSX intrinsics only.

---

## Components

### `<civitai-button>` — enhance-only

`variant` (`filled`|`light`|`outline`|`subtle`) · `size` (`sm`|`md`|`lg`) ·
`color` (`primary` | a semantic token name | any CSS colour) · `loading` ·
`full-width` · `disabled` · `type` (`button`|`submit`|`reset`, default
`button`).

`color` is the prop `components-react`'s Button drops entirely — an app
switching imports loses every semantic accent silently.

Because it is a custom element rather than a `<button>`, activation is
hand-written to match the native one exactly: Enter on `keydown`, Space on
`keyup`, `tabindex` removed while disabled, clicks swallowed with
`stopImmediatePropagation`. It is form-associated *only* so `type="submit"`
can reach the owning form (including through `form="<id>"`, which
`closest('form')` cannot see); it never calls `setFormValue`, so it
contributes nothing to `FormData`.

### `<civitai-stack>` — enhance-only

`gap` · `align` · `justify`.

`gap` accepts **both** drifted contracts: a named step (`none`/`xs`/`sm`/`md`/
`lg`/`xl`) resolves through the stylesheet's `[gap=…]` rules; anything else is
a CSS length (a bare number is px, the `blocks-react` behaviour) and lands on
`--civitai-stack-gap`. No input can be silently dropped — asserted
exhaustively.

### `<civitai-select>` — form-associated leaf

`name` · `value` · `options` · `placeholder` · `label` · `description` ·
`error` · `required` · `disabled`. Fires `change` and `input` with
`detail: { value }`.

Resolves the sharpest drift by following the **native** contract, which is
what both React versions were approximating. `value` is a live property; the
user can move it; a `change` event reports the new value. A React consumer who
writes `value` every render gets controlled behaviour, one who writes it once
gets uncontrolled behaviour. There is no third contract.

### `<civitai-slider>` — form-associated leaf

`name` · `value` · `min` · `max` · `step` · `label` · `description` · `error` ·
`required` · `disabled` · `show-value`. Fires `input` and `change` with
`detail: { value }` (a **number**, not the DOM's string).

`required` on a range input is meaningless natively — a range always has a
value, so `valueMissing` can never fire, which is why one package forwarded it
uselessly and the other dropped it. Here it means the only thing it can mean:
*the user must have moved it*. Until the first `input` the element is
`valueMissing`, anchored on the real control, with `aria-required="true"` on
that control and the asterisk in the label.

---

## Pipeline

```
src/**/*.css ──(scripts/build-css.ts)──> src/generated/*.css.ts   [committed]
                                     └─> dist/styles.css

src/**/*.ts  ──(cem analyze)─────────> custom-elements.json       [committed]
                                          │
                     ┌────────────────────┼────────────────────┐
                     ▼                    ▼                    ▼
       elements-react/src/          api-snapshot.json     README tables
         generated/jsx.ts           (the CI diff gate)
```

Custom Elements Manifest is the single source of truth. Everything downstream
is generated and committed, and `test/generation-parity.test.ts` re-runs each
generator and fails on any diff — a committed generated file that can go stale
is worse than one that is built on demand.

### The API snapshot gate

```bash
pnpm --filter @civitai/elements api:check     # CI
pnpm --filter @civitai/elements api:snapshot  # accept a deliberate change
```

Pins, per tag: every attribute (name, type, default), every writable property,
every documented event with its detail type, every CSS custom property, and
whether the element is form-associated. Deliberately **not** descriptions —
prose churn must not fail CI, or the gate becomes the permanently-red kind
everyone clicks through.

A failure is not "you did something wrong", it is "this changes the public
surface — confirm it is intended, then `api:snapshot` and commit the diff in
the same PR", which is what puts the change in front of a reviewer.

---

## Tests

```bash
pnpm --filter @civitai/elements test          # unit  (happy-dom)
pnpm --filter @civitai/elements test:browser  # browser (real Chromium)
```

🔴 **Both tiers are required, and the split is not arbitrary.** happy-dom
20.9.0 does not implement `attachInternals` at all
(`typeof HTMLElement.prototype.attachInternals === 'undefined'` — measured), so
every form-participation and validity assertion is *structurally invisible*
there and would pass vacuously. All of those live in `*.browser.test.ts`.
`test/no-vacuous-form-tests.test.ts` asserts the limit, so the day happy-dom
gains `ElementInternals` that test fails and the split gets re-read
deliberately instead of silently becoming wrong.

On NixOS:

```bash
nix-shell -p chromium --run \
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) pnpm --filter @civitai/elements test:browser'
```

### Mutation battery

```bash
node scripts/mutation-check.mjs
```

Breaks one mechanism at a time and asserts the matching guard goes red on
**its own** assertion, so a guard is never merely believed. Includes a positive
control (an obviously-wrong mutation that must be caught) and a baseline run
(green, or every other row is void), and refuses to run a mutation whose search
string does not match exactly once — a no-op mutation would otherwise be scored
SURVIVED and read as a coverage gap that does not exist.

---

## Decisions

See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for the full record, including
the ones that are not yet implemented (segmented-control roles, `Alert` role
derivation) and the ones deliberately left open.
