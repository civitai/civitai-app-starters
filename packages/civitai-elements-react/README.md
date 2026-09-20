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

Nothing but `.d.ts` plus a side-effect import. `src/generated/jsx.ts` is
generated from `@civitai/elements`' `custom-elements.json` by
`scripts/gen-react-types.mjs` in that package, and
`@civitai/elements`'s `test/generation-parity.test.ts` re-runs the generator
and fails on any diff.

```bash
pnpm --filter @civitai/elements gen:react
```

Getter-only members (`form`, `validity`, `validationMessage`, `willValidate`)
are part of the element's surface but deliberately **not** of the JSX surface —
writing `validity={…}` in JSX would throw at runtime.

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
pnpm --filter @civitai/elements-react test:browser
```

On NixOS:

```bash
nix-shell -p chromium --run \
  'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(command -v chromium) pnpm --filter @civitai/elements-react test:browser'
```

These are **invariant guards** about React, not regression coverage for this
package: they pin the behaviour the no-wrapper decision rests on. If a future
React breaks any of them, wrappers become necessary and this file is the
trigger.
