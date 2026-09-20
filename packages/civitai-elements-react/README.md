# @civitai/elements-react

Typed React JSX intrinsics and event details for
[`@civitai/elements`](../civitai-elements).

**There are no wrapper components here, and there are not meant to be.**

```bash
pnpm add @civitai/elements @civitai/elements-react
```

```tsx
import '@civitai/elements-react'; // registers the elements + brings the types into scope

function GenerateForm() {
  const [sampler, setSampler] = useState('euler');
  return (
    <civitai-stack gap="lg">
      <civitai-select
        name="sampler"
        label="Sampler"
        options={SAMPLERS}
        value={sampler}
        onchange={(e) => setSampler(e.detail.value)}
      />
      <civitai-slider name="cfg" label="CFG" min={1} max={20} value={7} show-value />
      <civitai-button variant="filled" loading={busy}>Generate</civitai-button>
    </civitai-stack>
  );
}
```

---

## Why types and not wrappers

Wrapper components exist to paper over two React defects. React 19 has
neither. Both facts are **measured** in
`test/react19-custom-elements.browser.test.tsx` against react-dom 19.2.6 in
real Chromium, not taken from the Custom Elements Everywhere score:

1. **A non-primitive or boolean prop is set as a PROPERTY.** `options={[…]}`
   arrives as the array; no `options` attribute is written. React 18 would have
   stringified it to `"[object Object]"`.
2. **An `on<name>` prop attaches a real listener.**

So a wrapper would add a component-tree layer, a forwarded-ref hop, and a
published runtime to keep in sync with every element change — for nothing. Refs
point straight at the upgraded element, so `ref.current.checkValidity()` and
the rest of the form-associated surface are reachable without re-exposing them
by hand.

---

## 🔴 The one sharp edge: two event spellings, two runtime shapes

Measured, same run:

| prop | listens for | receives | `detail` |
|---|---|---|---|
| `onchange` | `change` | `CustomEvent` | **preserved** |
| `onChange` | `change` | `SyntheticBaseEvent` | **`undefined`** |
| `oninput` | `input` | `CustomEvent` | **preserved** |
| `onInput` | `input` | `SyntheticBaseEvent` | **`undefined`** |
| `oncivitai-x` | `civitai-x` | `CustomEvent` | **preserved** |
| `onCivitaiX` | `CivitaiX` | *never fires* | — |

React's rule for a custom element: `on` + a **lowercase-initial** remainder is
attached verbatim with `addEventListener`; `on` + an **uppercase-initial**
remainder goes through React's own event system, which wraps *registered* names
(`Change` → `change`) in a SyntheticEvent and attaches *unregistered* ones
under the literal capitalised name that nothing dispatches.

**Prefer the lowercase spelling** — `onchange`, `oninput` — and read
`event.detail`.

The camelCase spelling is still typed, because React users write it by reflex
and it *does* fire; it is typed as a `React.SyntheticEvent<TheElement>` so that
reaching for `.detail` is a compile error rather than a runtime `undefined`.
Read `event.currentTarget.value` with that spelling.

---

## What ships

Nothing but `.d.ts` plus a side-effect import — **one** subpath, `.`.

`src/generated/jsx.ts` is generated from `@civitai/elements`'
`custom-elements.json` by this package's own `scripts/gen-jsx-types.mjs`, and
`test/generation-parity.test.ts` re-runs the generator (into a temp directory,
so it never touches the working tree) and fails on any diff.

```bash
pnpm --filter @civitai/elements-react generate
```

Getter-only members (`form`, `validity`, `validationMessage`, `willValidate`)
are part of the element's surface but deliberately **not** of the JSX surface —
writing `validity={…}` in JSX would throw at runtime.

### What this package does NOT export

Only the four `Civitai*Props` types, which exist nowhere else. It deliberately
re-exports **nothing** from `@civitai/elements` — not `ButtonVariant`, not
`ButtonSize`, not the element classes. Import those from `@civitai/elements`
(or `@civitai/elements/button`), where they are declared.

That is not pedantry. This package exists downstream of the 34-duplicated-names
problem; an earlier version re-exported `ButtonVariant` and `ButtonSize` as a
convenience, which took two of those names from two definitions across the
fleet to three.

### Why a separate package rather than `@civitai/elements/react`

Because `@civitai/elements` is framework-agnostic and must stay that way —
that property is one of the three arguments that survive the bundle-size
retraction in its README. A `./react` subpath would put React in its peer
dependencies and force this package's `^19`-only constraint onto it. Keeping
the boundary is also the reversible choice: adding a runtime to an existing
npm name is easy, un-publishing a subpath is not. Full reasoning and the
conditions that would reopen it: `@civitai/elements/docs/DECISIONS.md` §6b.

---

## Peer range

`react: ^19` only, deliberately narrower than the `^18 || ^19` the older
packages declare. The whole premise of this package is React 19 behaviour.
Declaring `^18` would be a range that installs cleanly and breaks at runtime —
see the peer-range note in `@civitai/blocks-react/package.json` for the same
defect, measured.

---

## Tests

```bash
pnpm --filter @civitai/elements-react test          # unit: the tsc TYPE gate + generation parity
pnpm --filter @civitai/elements-react test:browser  # real Chromium: the React-19 evidence
```

Both tiers run in CI. The unit tier is the type gate (`tsc` over
`test/fixtures/*.tsx`, asserting that a wrong prop type is a compile error and
that `onChange` + `.detail` does not compile); it previously ran nowhere.

On NixOS:

```bash
nix-shell -p chromium --run \
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) pnpm --filter @civitai/elements-react test:browser'
```

These are **invariant guards** about React, not regression coverage for this
package: they pin the behaviour the no-wrapper decision rests on. If a future
React breaks any of them, wrappers become necessary and this file is the
trigger.
