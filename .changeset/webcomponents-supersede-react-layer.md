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

## Migrating

The import rename is the easy half:

```diff
-import { Button, Card, TextInput } from '@civitai/components-react';
+import { CivitaiButton, CivitaiCard, CivitaiTextInput } from '@civitai/components-react';
```

🔴 **Renaming alone is NOT enough, and THREE cases are silent — they type-check
and then quietly do the wrong thing.** Two are prop NAMES: the elements' names
are not the React layer's, and `@lit/react` passes anything it does not
recognise straight to `React.createElement`, where an unknown name becomes a
plain HTML attribute rather than an error. The third is a prop DEFAULT, which
no rename can reveal — the names match and the rendering changes anyway.

| Was (0.7.x) | Is (0.8.0) | What a bare rename does |
|---|---|---|
| `<Alert title="Saved">` | `<CivitaiAlert heading="Saved">` | 🔴 `title` is a **global** HTML attribute, so it becomes a mouse-hover tooltip and the bold heading silently disappears. No type error. |
| `<Alert onClose={fn}>` | `<CivitaiAlert closable onClose={fn}>` | 🔴 `onClose` is in the event map so it type-checks and attaches, but the element renders no dismiss button without `closable`. Dead callback, no button, no error. |
| `<Toast title=… onClose=…>` | `<CivitaiToast heading=… closable onClose=…>` | 🔴 identical to Alert, same two traps. |
| `<Card>` (no props) | `<CivitaiCard withBorder padding="md">` | 🔴 SAME NAMES, DIFFERENT DEFAULTS. The React `Card` defaulted `padding='md'` and `withBorder={true}`; `<civitai-card>` defaults to `padding=''` and `withBorder` unset. A bare `<CivitaiCard>` silently loses **16px of padding** in both themes, and its border weakens: in **dark** it disappears (`--civitai-card-border-width: 0`), in **light** it stays 1px but drops from the opaque `--civitai-color-border` to a 55%-opacity mix — light gives a borderless card a default hairline because surface and body are both `#fefefe` there. Pass both props explicitly. `<Card withBorder padding="lg">` with both already stated is unaffected. |
| `<Button variant size loading fullWidth>` | unchanged | ✅ same names AND same defaults |

`Card` is the only default that moved. Badge, Loader, Slider, RadioGroup,
SegmentedControl, Image, Stack, Group and Button all carry element constructor
defaults identical to the React ones they replace — which is a statement about
DEFAULTS only; several of them still need the contract read for other reasons,
listed below.

Everything else:

- **Handlers receive the DOM event**, not an extracted value:
  `onChange={(e) => e.currentTarget.value}`. Field elements re-dispatch the
  native `change`, which commits on blur/Enter rather than per keystroke — so a
  controlled input that previously updated per keystroke now updates on commit.
- **`injectStyles` / `useComponentStyles` are gone** from this package because
  nothing here needs them: the elements are self-styling in shadow DOM and
  inject the `@civitai/theme` tokens themselves. Import `injectStyles` from
  `@civitai/components` if you also render bare `data-civitai-ui` markup.
- **`segmentId` is gone.** It existed to wire `aria-controls` for the deleted
  `SegmentedControl`'s `mode="tabs"`. The elements split that case out:
  `<civitai-segmented-control>` is the panel-less `radiogroup`, and
  `<civitai-tabs>` / `<civitai-tab-panel>` own the panel-switching one and do
  their own wiring.
- 🔴 **Every PROP TYPE the root used to export is gone** — `ButtonProps`,
  `ButtonVariant`, `ButtonSize`, `CardPadding`, `Gap`, `AlertColor`,
  `BadgeColor`, `SegmentedControlMode`, `SegmentItem`, `ImageFit`,
  `ImageStatus`, `ToastApi`, `ToastOptions` and the rest. `export *` re-exports
  **values only**, and the bindings derive their props from the element class
  rather than declaring named interfaces. To name one, go through the
  component: `React.ComponentProps<typeof CivitaiButton>`. Element-level unions
  — `BadgeVariant`, `LoaderSize`, `ButtonVariant`, `ButtonSize`, `CardPadding`
  and friends — do still have named exports, but on the **per-element
  subpath**, NOT on the `@civitai/components` root, which exports only
  `componentsCss`, `COMPONENT_NAMES`, `ComponentName` and `injectStyles`:

  ```ts
  import type { BadgeVariant } from '@civitai/components/civitai-badge';
  import type { ButtonVariant, ButtonSize } from '@civitai/components/civitai-button';
  ```

Not a rename at all: if you were using `TabPanel`, `Toast`/`ToastProvider`/
`useToast`, `Tooltip`, `Radio` or `Image`, read the element's own contract
first — `civitai-toast-region` owns the live region the provider used to,
and there is no standalone `civitai-radio` (use `<civitai-radio-group>`).

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
would have compared the elements to themselves. The axe a11y sweep was
retargeted onto the elements and still covers every component family in light
and dark. The opt-in visual-regression layer was **deleted, not retargeted** —
an audit found it had never run anywhere: its `VITE_RUN_VR` opt-in was set in
no workflow, script or `.env`, and no baselines were ever committed. It was 46
of the package's 99 browser tests, all of them skips. The entry-point guard
that required the `.` entry to reach no element module was rewritten rather
than dropped: it now pins that the root and the presentational barrel reach
the SAME external specifiers — set equality, so an extra at the root and a gap
at the root both fail — and that the root still reaches no `@civitai/sdk`.

**Release sequencing.** The two starters in this repo import the new names, and
their `@civitai/components-react` pins are `^0.7.0` — which, being 0.x, admits
only `0.7.x`. Between merging this and publishing 0.8.0, `npx tiged` of those
starters scaffolds a project that does not compile. `changeset version` rewrites
the pins, so the fix is to publish promptly rather than to change anything here;
the nightly published-starter smoke job will flag the window while it is open.

`@civitai/components` (patch): stop shipping `dist/utilities.generated.*`, about
39 kB no consumer could reach (19,549 B of `.js` plus 19,383 B of `.d.ts` — the
glob takes both) — nothing imports it and there is no
`./utilities` export key, the utility layer being published as `./utilities.css`.
Unlike `styles.generated`, which `src/index.ts` imports and so ships via the `.`
entry. Same reasoning as the existing `!dist/css` exclusion; no API change.
