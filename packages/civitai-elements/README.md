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

### 🔴 What phase 1 does NOT yet do

**It has not closed that hazard.** All 34 colliding names still stand. Issue
#328 is the *motivation* for this package, not something it has fixed — do not
cite it as a delivered result until real seams land.

🔴 **There is no strangler seam yet, deliberately.** An earlier revision of
this branch made `@civitai/blocks-react`'s `Stack` render `<civitai-stack>`,
which meant a **published** package taking a `workspace:*` dependency on this
**unpublished** one. `@civitai/elements` 404s on the npm registry (control:
`@civitai/blocks-react` returns 200), so the next `blocks-react` release would
have had to co-publish this package or ship a dependency resolving to nothing.
The seam was removed; the two packages have no edge between them today, and
the first seam lands only once this package has a published version to depend
on.

Two consequences worth stating plainly:

- **Adding names here can make #328 worse.** `@civitai/elements-react` briefly
  re-exported `ButtonVariant` and `ButtonSize`, which took two of the 34 from
  two definitions to three. Removed. Don't re-add that kind of convenience.
- **One real bug went out with the seam.** The removed shim incidentally fixed
  `blocks-react/ui`'s `Stack`, where `gap="md"` typechecks and silently renders
  the default spacing. Tracked as #357, and it belongs in the React package —
  not in a seam.

---

## 🔴 Bundle size is NOT a reason to adopt this package — retracted

An earlier version of this README led with "one Button: 52,568 B → 21,309 B, a
59.5% cut." **That claim is withdrawn.** It is arithmetically correct and
analytically worthless, because it compares a per-component-CSS design against
a baseline whose size is caused by something else entirely, and then credits
the difference to custom elements.

`node scripts/measure-bundle.mjs` now splits every row into a JS column and a
CSS column and adds the control that was missing:

| scenario | total | JS | CSS | gzip | vs A |
|---|---|---|---|---|---|
| **A.** `blocks-react/ui` Button — un-split baseline | 52,568 | 2,417 | 50,151 | 12,478 | 100% |
| **B.** `blocks-react/ui` Button — **CSS split in place** | **13,480** | **2,417** | **11,063** | **3,525** | **25.6%** |
| **C.** `@civitai/elements/button` — custom element | 21,309 | 11,154 | 10,155 | 6,247 | 40.5% |

Read the columns, not the totals:

- **95.4% of the baseline is stylesheet text.** `ui/Button.tsx` imports
  `useBlocksStyles` from `./styles.js`, whose `BLOCKS_UI_STYLES` concatenates
  the theme tokens, the WHOLE of `@civitai/components`' sheet and this
  package's `INTERACTIVE_STYLES` into one `export const` string. A bundle
  containing only a Button therefore also contains the CSS for SegmentedControl,
  Toast, Tooltip, NumberInput and fifteen others.
- **Row B fixes exactly that, and nothing else.** No new package, no Lit, no
  custom element, no new contract: just `@civitai/components`' sheet sliced per
  component so Button's bundle carries Button's rules (plus Loader's, which
  `<Button loading>` renders). It is a real build of a real slice — the slicer
  is asserted lossless against `src/components.css` before any number is
  reported.
- **Row B beats row C by 37%** (and by 43% gzipped). The CSS columns are within
  ~900 B of each other; the difference between the two is the **JS column**,
  where the custom element costs **4.6× more** — `@lit/reactive-element`, the
  base classes, and style adoption.

So: **on bytes, the control wins.** If bundle size is the deciding criterion,
the right change is to split `@civitai/components`' stylesheet inside the
existing packages and not to adopt this one.

The reasons to adopt this package are the ones that survive that measurement:

1. **One implementation instead of two.** 34 component names are currently
   defined twice with drifted contracts (see the table above). A custom element
   is consumable from React, Svelte, SvelteKit and plain HTML, so the duplicate
   pair collapses to one. *Phase 1 does not yet deliver this* — see "What phase
   1 does NOT yet do" above.
2. **Form association.** `ElementInternals` gives a component real
   participation in `<form>` submission, validation and reset. There is no
   React-only equivalent; `@civitai/components-react`'s `Slider` documents
   `required` and forwards it nowhere.
3. **Framework independence.** The starters span React, Svelte and plain HTML.
   This is the argument that now carries the case, which is why the React
   bindings stay in a separate downstream package rather than becoming a
   `@civitai/elements/react` subpath.

Two things that remain true and are worth knowing:

- The cost CURVE differs. The React packages pay ~50 KB of CSS for the first
  component and ~0 for the next 33; this package pays ~12 KB shared plus ~1–4 KB
  each. Under a per-component split (row B) the React side pays per component
  too, so the curves converge and the JS column decides — in the React side's
  favour.
- A strangler seam makes the `/ui` barrel **bigger** while it is in place, and
  that cost is measured, not hypothetical: the now-removed `Stack` shim took
  the barrel from 110,772 B to 121,742 B, because the shim rendered
  `<civitai-stack>` *and* still injected the pack stylesheet, so the bundle
  carried both design systems. With the seam gone the barrel is back to
  **110,772 B** (`pnpm --filter @civitai/elements measure`, last row — re-run
  after the removal). Expect the same +11 KB back when the first real seam
  lands; it does not come down until the monolithic stylesheet string is gone.

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

### Mutation battery — MANUAL, not a CI gate

```bash
pnpm --filter @civitai/elements mutation:check
# NixOS: prefix with
#   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium')
```

Breaks one mechanism at a time and asserts the matching guard goes red on
**its own** assertion, so a guard is never merely believed. Result: **15/15
killed**.

It is deliberately outside CI. Each mutant pins an exact source string, so an
unrelated refactor of the targeted line stops it applying — as a required gate
that is the permanently-red kind everyone learns to click through. Run it by
hand whenever you touch a guard or the code a guard protects.

Controls: a positive-control mutant that must obviously be caught; a baseline
run that must be green (or every other row is void); a refusal to run any
mutation whose search string does not match exactly once (a no-op mutation
would otherwise be scored SURVIVED and read as a coverage gap that does not
exist); and — added after a re-run caught it — a refusal to score any run that
produced no parseable vitest summary.

🔴 That last control was earned. A re-run of the battery reported
`D1 … SURVIVED, failures (0): (none)`. D1 is in fact killed by three
assertions; the run had simply produced no result line at all (a browser tier
that failed to come up), and the loop read the ABSENCE of parsed failures as
"the guard did not fire". An absence is the observable that an infrastructure
failure and a weak guard share, so it identifies neither. The loop now aborts
on it. With the control in place the battery reproduces 15/15.

---

## Decisions

See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for the full record, including
the ones that are not yet implemented (segmented-control roles, `Alert` role
derivation) and the ones deliberately left open.
