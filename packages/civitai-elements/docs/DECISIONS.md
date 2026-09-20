# Decisions — `@civitai/elements` phase 1

Each entry records what was decided, the evidence, and what would change it.
Entries marked **OPEN** are deliberately unresolved.

---

## 1. Light DOM, not shadow DOM

**Decided by the operator.** Apps run on dedicated pages or inside block
iframes, so style encapsulation buys nothing measurable, and shadow DOM costs a
great deal under the SSR starters: React has no Declarative Shadow DOM support
([facebook/react#33698](https://github.com/facebook/react/issues/33698)), so
every shadow-rooted element is client-only with a flash. `@lit-labs/ssr-react`
and `React.createElement` monkey-patches were ruled out.

Consequence: no `<slot>`. Everything in decision 2 follows from this one.

---

## 2. Wrappers are enhance-only; leaves take content via properties

The no-slot consequence, made structural.

`CivitaiEnhanceElement extends ReactiveElement` — no templating layer at all.
A subclass cannot clobber children because no code path writes them.
`CivitaiFieldElement extends LitElement` with `createRenderRoot() { return this }`
for leaves that own their content.

**Evidence.** `test/light-dom-children.test.ts` asserts node *identity* (not
text content — a wrapper that re-created an equivalent child would still read
"the text is there" while destroying focus, listeners and React state) across
repeated reactive updates, plus that the Button adds no element of its own even
while loading. `test/enhance-only.test.ts` walks the transitive import graph
from each wrapper entrypoint and fails if it reaches `lit`/`lit-html`, with a
positive control proving the walker can see such an import.

**Mutation-verified.** Making the wrapper base replace its children kills four
assertions; turning the spinner into a real child kills two; adding a `lit`
import to `stack.ts` kills the architecture guard.

**This diverges from the brief's recommendation in one detail.** The
recommendation was "layout/wrapper primitives are enhance-only — they set
attributes and CSS hooks and never render content". Adopted, and extended to
`Button`, which the brief listed as a *component with children* rather than a
wrapper. The cost is that `leftSection` / `rightSection` stop being props and
become ordinary children (spaced by the host's `gap`); the benefit is that
Button's module graph never loads `lit-html`, which is 6.8 KB of the 21.3 KB
one-Button bundle. (Note the scope: that saving is real *within* this package.
It does not make the package smaller than the React Button it replaces — see
decision 8.)

---

## 3. Form-associated via `ElementInternals`; the inner control has no `name`

The host owns `name`. The inner native control is kept — it is where combobox
semantics, keyboard handling, type-ahead and the native popup come from — but
it is nameless, so it cannot participate in submission.

**Evidence.** `test/form-participation.browser.test.ts`: real `<form>`, real
`FormData`, three layers (value / cardinality / a structural ledger over the
subtree). The cardinality assertion is the one that catches a duplicate; a
value-only assertion passes straight through a double-submit when both entries
carry the same string.

**Mutation-verified.** Adding `name=${this.name}` to the inner `<select>` kills
five assertions; the same on the range input kills three.

---

## 4. `Select` follows the native contract

The two React versions are not interchangeable in either direction: one is
strictly controlled, the other is an uncontrolled native `<select>` taking
`<option>` children. The element implements the contract both were
approximating — `value` is a live property, the user can move it, a `change`
event reports the new value. A consumer writing `value` every render gets
controlled behaviour; one writing it once gets uncontrolled behaviour. No third
contract is invented.

Options arrive as an `options` **property** rather than children, because a
leaf owns its content (decision 2) and because React 19 sets non-primitive
props as properties (decision 6).

---

## 5. `required` on a slider means "the user moved it"

Natively meaningless: a range input always has a value, so `valueMissing` can
never fire. `blocks-react/ui` forwards `required` to the input where it does
nothing; `components-react` documents it on the shared field props and forwards
it nowhere. Both are wrong in the same direction — the prop reads as
implemented and is not.

Redefined to the only semantic a range can carry: until the first `input`
event, the element is `valueMissing`, anchored on the real control. The label
gets the asterisk, the control gets `aria-required="true"`.

**This is a behaviour change, not just a fix**, and it is the sharpest
divergence from "port the existing contracts". A form containing
`<civitai-slider required>` will not submit until the user touches the slider —
which is what `required` has always claimed and never delivered, but it is new
behaviour for anyone who set it and did not notice it was inert. Flagged for
the operator.

`formResetCallback` clears the touched flag, so reset restores the initial
state rather than leaving a satisfied-but-reset control.

---

## 6. React needs types, not wrappers — with one sharp edge

**Measured**, react-dom 19.2.6 in real Chromium
(`@civitai/elements-react/test/react19-custom-elements.browser.test.tsx`):

- a non-primitive prop is set as a **property**, not a stringified attribute
  (`options={[…]}` arrives as the array; no `options` attribute is written);
- a boolean prop is set as a property the element reflects;
- an `on<name>` prop attaches a real listener.

So a wrapper would add a component layer, a forwarded-ref hop and a published
runtime for nothing. `@civitai/elements-react` ships `.d.ts` and a side-effect
import.

**The sharp edge, also measured:**

| prop | listens for | receives | `detail` |
|---|---|---|---|
| `onchange` | `change` | `CustomEvent` | preserved |
| `onChange` | `change` | `SyntheticBaseEvent` | **`undefined`** |
| `oninput` | `input` | `CustomEvent` | preserved |
| `onInput` | `input` | `SyntheticBaseEvent` | **`undefined`** |
| `oncivitai-x` | `civitai-x` | `CustomEvent` | preserved |
| `onCivitaiX` | `CivitaiX` | never fires | — |

React's rule: `on` + a lowercase-initial remainder is attached verbatim with
`addEventListener`; `on` + an uppercase-initial remainder goes through React's
own system, which wraps *registered* names in a SyntheticEvent and attaches
*unregistered* ones under the literal capitalised name that nothing dispatches.

The generator emits both spellings with **honest, different types**: the
lowercase form as `CustomEvent<Detail>`, the camelCase form as a
`React.SyntheticEvent<TheElement>` whose doc comment says to read
`currentTarget.value`. Typing `onChange` as `CustomEvent<Detail>` would
compile, render, fire, and hand the consumer `undefined`. Omitting it is worse:
React users write it by reflex, it *does* fire, and an unknown prop on a custom
element is passed through as an attribute with no error at all.

This is why events are named `change`/`input` rather than `civitai-change`: a
kebab name would sidestep the SyntheticEvent wrapping, but it would also mean
every non-React consumer and every form library has to learn a non-standard
event name for a control that is otherwise indistinguishable from a native one.
**OPEN** if the SyntheticEvent edge proves confusing in practice.

### 6b. `@civitai/elements-react` stays a SEPARATE package, and stays types-only

The brief asked for "react specific bindings and hooks in a dedicated
downstream package". The measurements above say the *hooks* half is
unnecessary: React 19 sets properties, attaches listeners, and hands back a
ref to the upgraded element, so there is nothing for a binding layer to do.
Review raised the obvious objection — a types-only package whose generator
lived in a sibling is a package boundary with nothing behind it — and offered
two ways out: add hooks, or collapse to `@civitai/elements/react`.

**Neither. The package stays, and it stays types-only.** Reasoning:

- Inventing `useCustomEventListener` / `useUpgraded` to justify the boundary
  would be adding runtime *because the brief said hooks*, in a PR whose whole
  correction is that the brief's premise was not measured. The one sharp edge
  a hook could smooth (`onChange` loses `detail`) already has a working
  declarative answer in the `onchange` spelling, which the generator types.
- Collapsing to `@civitai/elements/react` would put React in the peer
  dependencies of the package whose **framework independence is now the
  strongest remaining argument for its existence** (see decision 8). It would
  also force the `^19`-only constraint of decision 7 onto a package that has
  no business declaring a React range at all.
- Separate is the REVERSIBLE choice. Publishing hooks later into an existing
  name is easy; un-publishing a React subpath from a framework-agnostic
  package is not, and a published npm name is close to permanent.

What review was right about, and what changed:

- the generator moved from `@civitai/elements/scripts/gen-react-types.mjs` to
  `@civitai/elements-react/scripts/gen-jsx-types.mjs`, so the package
  generates its own source and `pnpm --filter @civitai/elements-react
  generate` no longer shells into a sibling;
- its parity test moved with it (`test/generation-parity.test.ts`);
- its unit tier — the tsc-over-fixtures TYPE gate — now runs in CI; it did not;
- `exports["./types"]` pointed at `dist/types.d.ts` / `dist/types.js`, which no
  build emits. Removed (every type it would have re-exported is already on
  `.`), and `pnpm check:exports` now imports every declared subpath of every
  publishable package out of its packed tarball;
- the package no longer re-exports `ButtonVariant` / `ButtonSize` / the element
  classes from `@civitai/elements`. That convenience took two names from #328's
  collision list from two definitions to three.

**Reopen this if** any of these becomes true: React 18 has to be supported; an
element gains an event whose name React cannot attach in either spelling; or
SSR property-seeding needs a client-side hook. Each is a measurable trigger,
not a matter of taste.

---

## 7. React peer range is `^19` only

Deliberately narrower than the `^18 || ^19` the two existing packages declare.
The no-wrapper premise rests on React 19 behaviour that React 18 does not have.
Declaring `^18` would be exactly the defect `@civitai/blocks-react`'s
peer-range note documents at length: a range that is metadata, satisfied at
install time, and broken at runtime. Every consumer measured across the 33 app
repos is already on React 19; the `^18` half of the existing range is declared
but unexercised.

---

## 8. Per-component stylesheets, adopted per root

Each component carries only its own rule text and adopts it on first upgrade,
keyed on (root node, component id), using a constructed `CSSStyleSheet` where
available and a `<style data-civitai-element>` otherwise.

`ReactiveElement`'s `static styles` cannot be used: it writes
`renderRoot.adoptedStyleSheets`, which exists on `Document` and `ShadowRoot`
but not on an ordinary element.

🔴 **Retracted claim.** This section used to end "Measured effect: one Button
52,571 B → 21,309 B", which read as a reason to adopt custom elements. It is
not one. Per-component CSS is a good design, but it is available *without* them:
slicing `@civitai/components`' stylesheet in place gets the existing React
Button to **13,480 B**, beating this package's 21,309 B by 37%. The whole
baseline-vs-element gap is the CSS column; the JS column moves the other way,
4.6× against the element. Three-column measurement, method and control in the
README and in `scripts/measure-bundle.mjs`.

What stays true: adopting per-root, per-component sheets is the right shape for
a light-DOM element and is what makes row C's CSS column (10,155 B) comparable
to a properly-split React Button's (11,063 B) rather than 5× worse.

---

## 9. `data-civitai-ui` is still emitted

The brief measured that `civitai/civitai` has **zero** references to
`data-civitai-ui` (with a positive control confirming the search works), so it
is an internal contract and free to change. The elements select on their **tag
name** — but they still set `data-civitai-ui="<name>"` on the host, because
`@civitai/components`' shipped stylesheet and an unknown amount of app-side CSS
select on it, and one attribute is a very cheap bridge during a strangler
migration.

**OPEN**: drop it once the migration completes and the fleet has been swept.

---

## 10. The strangler seam is `Stack`

`@civitai/blocks-react/ui/Stack.tsx` is now a compatibility shim rendering
`<civitai-stack>`. Its six existing tests are unchanged and green.

`Stack` was chosen over `Card`/`Button` for a mechanical reason: `Card`'s
existing test asserts `ref.current.tagName === 'DIV'`, which cannot survive the
migration without editing the test — and the point of the first seam is to
prove the path with *zero* test churn. `Card` is the next seam and its test
needs one line changed.

The shim quietly fixes `gap="md"` on the way through (routed to the element's
`gap` attribute instead of an invalid `style.gap`). `Stack.test.tsx` passes
whether or not the element upgrades, so `Stack.strangler.test.tsx` is the
positive control: it asserts the tag, the upgrade, and the behaviour only the
element can provide.

One type change: the forwarded ref is `HTMLElement`, not `HTMLDivElement`.
Assignment still works (object property types are covariant), but code reading
`.tagName === 'DIV'` will notice.

---

## 11. Not done in phase 1 — decided, not implemented

**Segmented control: `radiogroup` / `radio`, not `tablist` / `tab`.**
A segmented control selects a **value**; a tablist switches **panels**.
`tablist` is a contract the component cannot keep on its own: it obliges each
tab to own an `aria-controls` pointing at a `role="tabpanel"`, and a consumer
using a segmented control to pick a sampler has no panels to point at, so the
markup is a lie that a screen reader reads aloud. `radiogroup`/`radio` also
gives the right announcement ("2 of 4") and the right expectation for arrow
keys, and it composes with form association — a radio group has a value and a
name, which is exactly what the control is for. `blocks-react/ui` has this
wrong today.

**`Alert`: `role` derived from severity.** `role="alert"` is an assertive live
region that interrupts whatever a screen reader is saying. That is correct for
an error and actively hostile for an `info` notice, which should be
`role="status"` (polite) or no live region at all for static content.
`components-react` hardcodes `alert` for every severity.

Both are recorded here so the decision does not have to be re-litigated when
the components are built.

---

## 12. OPEN — the token sheet is an unconditional 5,984 B

`ensureTokens()` runs on first upgrade so that rendering any element is enough
to get the themed look, with no import and no setup step — DX parity with the
two packages being replaced, which pay the same cost. An app that already
`<link>`s `@civitai/theme/styles.css` pays it twice (once as a link, once in
the bundle).

Making it opt-in would cut the one-Button number to ~15.3 KB but would mean an
element can render unstyled, which is a worse failure than a duplicated
stylesheet. Leaving it as measured, and flagged. (Note that the same 5,984 B
is paid by every row of the measurement table, including the CSS-split-in-place
control, so it is not a difference between the options.)
