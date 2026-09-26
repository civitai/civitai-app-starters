---
'@civitai/components-react': minor
'@civitai/components': patch
---

**BREAKING (`@civitai/components-react`): the custom elements supersede the
hand-written React layer.** The `.` entry no longer exports `Button`, `Card`,
`TextInput`, `Alert`, `Badge`, `Loader`, `Stack`, `Group`, `Slider`,
`SegmentedControl`, `Select`, `Checkbox`, `Radio`, `RadioGroup`, `NumberInput`,
`Textarea`, `TabPanel`, `Toast`, `ToastProvider`/`useToast`, `Tooltip`, `Image`,
or `injectStyles`/`useComponentStyles`. It re-exports the generated
`@lit/react` element bindings instead — `CivitaiButton`, `CivitaiCard`,
`CivitaiTextInput`, and so on.

Migration is a rename plus two behavioural notes:

```diff
-import { Button, Card, TextInput } from '@civitai/components-react';
+import { CivitaiButton, CivitaiCard, CivitaiTextInput } from '@civitai/components-react';
```

- Handlers receive the **DOM event**, not an extracted value:
  `onChange={(e) => e.currentTarget.value}`. Field elements re-dispatch the
  native `change`, which commits on blur/Enter rather than per keystroke.
- `injectStyles` is gone from this package because nothing here needs it: the
  elements are self-styling in shadow DOM and inject the `@civitai/theme`
  tokens themselves. Import it from `@civitai/components` if you also render
  bare `data-civitai-ui` markup.

**Why.** The package had been shipping two unrelated implementations behind two
entry points: 21 hand-written components on `.` that re-rendered the
`data-civitai-ui` contract and imported no element, and 46 generated bindings on
`./elements` that were genuinely downstream of the elements and had no consumer
at all. Nothing compared the two, so they diverged where it was invisible —
`<Alert onClose>` rendered a dismiss button on one surface and not the other
with no type error, and `SegmentedControl` carried three different ARIA role
models and two-of-six keyboard nav across the layers. Collapsing onto the
elements removes the class, not the instances: there is now one implementation,
and a test fails if anything that is not a generated binding appears under
`src/`.

**Known cost, accepted deliberately.** Server rendering is now best-effort.
`@lit/react` assigns props as properties from effects, which do not run on the
server, so the wrappers emit bare tags that fill in after hydration; the
previous React layer server-rendered real markup. Where server output matters,
write the `<civitai-*>` tag directly in JSX so its attributes survive SSR, or
keep SEO-critical copy in ordinary HTML — which is what the `next-app` starter
demo now does.

**Test coverage moved rather than shrank.** The `html-vs-react-parity` suite is
deleted: it asserted that the React arm and a hand-written HTML arm computed
identically, and with one implementation there is no second arm — keeping it
would have compared the elements to themselves. The axe a11y sweep and the
opt-in visual layer were retargeted onto the elements and still cover every
component family in light and dark. The entry-point guard that required the `.`
entry to reach no element module was rewritten rather than dropped: it now pins
that the root IS the presentational barrel and nothing besides, and that it
still reaches no `@civitai/sdk`.

`@civitai/components` (patch): stop shipping `dist/utilities.generated.*`, about
19.5 kB no consumer could reach — nothing imports it and there is no
`./utilities` export key, the utility layer being published as `./utilities.css`.
Unlike `styles.generated`, which `src/index.ts` imports and so ships via the `.`
entry. Same reasoning as the existing `!dist/css` exclusion; no API change.
