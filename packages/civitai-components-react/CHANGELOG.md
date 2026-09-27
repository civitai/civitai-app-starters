# @civitai/components-react

## 0.9.0

### Minor Changes

- a65190f: **BREAKING (`@civitai/components-react`): the custom elements supersede the
  hand-written React layer.** The `.` entry no longer exports `Button`, `Card`,
  `TextInput`, `Alert`, `Badge`, `Loader`, `Stack`, `Group`, `Slider`,
  `SegmentedControl`, `Select`, `Checkbox`, `Radio`, `RadioGroup`, `NumberInput`,
  `Textarea`, `TabPanel`, `Toast`, `ToastProvider`/`useToast`, `Tooltip`, `Image`,
  `Text` (with `TextProps`/`TextAs`/`TextSize`/`TextWeight`), or
  `injectStyles`/`useComponentStyles`. It re-exports the generated
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

  | Was (0.8.x)                               | Is (0.9.0)                                    | What a bare rename does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `<Alert title="Saved">`                   | `<CivitaiAlert heading="Saved">`              | 🔴 `title` is a **global** HTML attribute, so it becomes a mouse-hover tooltip and the bold heading silently disappears. No type error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
  | `<Alert onClose={fn}>`                    | `<CivitaiAlert closable onClose={fn}>`        | 🔴 `onClose` is in the event map so it type-checks and attaches, but the element renders no dismiss button without `closable`. Dead callback, no button, no error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
  | `<Toast title=… onClose=…>`               | `<CivitaiToast heading=… closable onClose=…>` | 🔴 identical to Alert, same two traps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
  | `<Card>` (no props)                       | `<CivitaiCard withBorder padding="md">`       | 🔴 SAME NAMES, DIFFERENT DEFAULTS. The React `Card` defaulted `padding='md'` and `withBorder={true}`; `<civitai-card>` defaults to `padding=''` and `withBorder` unset. A bare `<CivitaiCard>` silently loses **16px of padding** in both themes, and its border weakens: in **dark** it disappears (`--civitai-card-border-width: 0`), in **light** it stays 1px but drops from the opaque `--civitai-color-border` to a 55%-opacity mix — light gives a borderless card a default hairline because surface and body are both `#fefefe` there. Pass both props explicitly. `<Card withBorder padding="lg">` with both already stated is unaffected. |
  | `<Button variant size loading fullWidth>` | unchanged                                     | ✅ same names AND same defaults                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

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
    import type { BadgeVariant } from "@civitai/components/civitai-badge";
    import type {
      ButtonVariant,
      ButtonSize,
    } from "@civitai/components/civitai-button";
    ```

  🔴 **`Text` is the one removal with a PUBLISHED predecessor of its own age.**
  It landed in `@civitai/components-react@0.8.0` (#477) on both tracks while this
  change was in flight, so `<Text>` existed publicly for exactly one release.
  Its replacement is `CivitaiText`, generated from `<civitai-text>`; the element,
  its CSS and its a11y coverage are untouched — only the hand-written React twin
  is gone. Anyone who adopted `<Text>` in 0.8.0 renames it like the rest.

  Not a rename at all: if you were using `TabPanel`, `Toast`/`ToastProvider`/
  `useToast`, `Tooltip`, `Radio` or `Image`, read the element's own contract
  first — `civitai-toast-region` owns the live region the provider used to,
  and there is no standalone `civitai-radio` (use `<civitai-radio-group>`).

  **Why.** The package had been shipping two unrelated implementations behind two
  entry points: 22 hand-written components on `.` that re-rendered the
  `data-civitai-ui` contract and imported no element, and 47 generated bindings on
  `./elements` that were genuinely downstream of the elements and had no consumer
  at all. (Both counts include `Text`/`civitai-text`, which landed on main from
  #477 while this was in flight and was merged in here — the hand-written half
  deleted with the other 21, the element kept.) Nothing compared the two, so they diverged where it was invisible —
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
  no workflow, script or `.env`, and no baselines were ever committed. It was 50
  tests, every one of them a skip — the layer enumerated `A11Y_CASES` × 2 themes,
  and that array stood at 25 cases when it was deleted. (No share of the browser
  tier is quoted. Two successive drafts of this sentence got that denominator
  wrong in the same way, by omitting the parity suite; the count of inert tests
  is what the deletion rests on, and it needs no ratio.) The entry-point guard
  that required the `.` entry to reach no element module was rewritten rather
  than dropped: it now pins that the root and the presentational barrel reach
  the SAME external specifiers — set equality, so an extra at the root and a gap
  at the root both fail — and that the root still reaches no `@civitai/sdk`.

  **Release sequencing.** The two starters in this repo import the new names, and
  their `@civitai/components-react` pins are `^0.8.0` — which, being 0.x, admits
  only `0.8.x`, and 0.8.0 is the release that shipped `Text` on the old layer.
  Between merging this and publishing 0.9.0, `npx tiged` of those starters
  scaffolds a project that does not compile. `changeset version` rewrites the
  pins, so the fix is to publish promptly rather than to change anything here;
  the nightly published-starter smoke job will flag the window while it is open.

  `@civitai/components` (patch): stop shipping `dist/utilities.generated.*`, about
  39 kB no consumer could reach (19,549 B of `.js` plus 19,383 B of `.d.ts` — the
  glob takes both) — nothing imports it and there is no
  `./utilities` export key, the utility layer being published as `./utilities.css`.
  Unlike `styles.generated`, which `src/index.ts` imports and so ships via the `.`
  entry. Same reasoning as the existing `!dist/css` exclusion; no API change.

### Patch Changes

- Updated dependencies [a65190f]
  - @civitai/components@0.8.1

## 0.8.0

### Minor Changes

- 4aa3a9f: Add `Text` — the typography primitive — on both tracks:
  `data-civitai-ui="text"` and `<civitai-text>`, plus the `<Text>` React binding.

  **Why.** The pack had no text, heading or paragraph component on either track —
  the only text-named elements were the two form controls, `civitai-text-input`
  and `civitai-textarea`. A consumer composing a page out of this pack could not
  put a headline, a paragraph or a section title on it, so every composed page
  read as a pile of self-labelling widgets. That is a hole in the design system
  rather than in any one consumer. (Typography _utilities_ were never the hole:
  `utilities.css` already ships `ci-fs-1`…`ci-fs-6`, the weights, `ci-muted` and
  `ci-truncate`. It is the component level that was empty — and note that
  `utilities.css` is **not** the transitional sheet; `bootstrap-compat.css` is the
  one markup migrates away from, toward these.)

  **The API**, derived from the components already here rather than invented:

  - **The element is the consumer's choice, and it carries the meaning.** `as`
    (element attribute) / the tag itself (attribute track): `p` (default), `span`,
    or `h1`–`h6`. A heading is a REAL heading element — that is what puts it in
    the document outline and a screen reader's heading list; `role="heading"` on a
    styled box is not a substitute. `<civitai-text as="h2">` renders an `<h2>`
    inside its shadow root, and an axe positive control (a deliberately skipped
    level must be REPORTED) is what proves that heading reaches the accessibility
    tree with its level intact.
  - **Size and heading level are independent.** `data-size` never changes what an
    element means and the element never changes the size, so an `<h2>` can be the
    small print of a card and a `<p>` can be the lede.
  - `data-size`: `xs` · `sm` · `md` (default) · `lg` · `xl` · `2xl` · `3xl` ·
    `4xl` · `5xl` — 12/13/14/16/20/24/28/32/40px. **One scale, in two halves.**
    `sm`/`md`/`lg` are byte-identical to Button's own font-size ramp, so one size
    name means one size across the pack, and `xs` is the 12px the field
    description already uses. Everything from `lg` up is a value `utilities.css`
    already ships as `ci-fs-N` — `lg`=`ci-fs-6`, `xl`=`ci-fs-5`, `2xl`=`ci-fs-4`,
    `3xl`=`ci-fs-3`, `4xl`=`ci-fs-2`, `5xl`=`ci-fs-1` — so the package has one
    type scale under two spellings rather than two that disagree. Nothing above
    `ci-fs-1` is invented. `xl` and up lead at 1.25; below it, 1.5.
  - `data-weight`: `normal` (default) · `medium` · `semibold` · `bold` — the
    weights `utilities.css` already spells, plus the 500 this sheet already uses.
  - **No colour axis**, and by the same predicate as alignment and truncation
    below: every value one would take already exists as a utility that reaches
    this element. `ci-muted` is the dimmed token, `ci-text-info` / `-success` /
    `-warning` / `-error` the intent enum, `ci-text-default` the body colour, and
    `color` **inherits** — so a utility on the element, or on any ancestor, reaches
    `<civitai-text>`'s shadow content too (its inner element is `color: inherit`).
    Both tracks are therefore `color: inherit` and Text does **not** paint
    `--civitai-color-text` itself: a _specified_ value beats an _inherited_ one at
    any specificity, so a token on the element would silently cancel every ancestor
    utility and make the sentence above false.
    ⚠️ **The trade, and it applies to pages that DO set a colour — not only to pages
    that set none.** Text renders in whatever colour it inherits, so wherever an
    ancestor colour and the token disagree, Text now follows the ancestor. Measured
    on both tracks, in the shape a block in this repo actually has — a
    `[data-theme="dark"]` root carrying `color: #e6e6e6` — Text computes
    `rgb(230, 230, 230)`, while restoring the removed declaration on the same
    fixture puts both tracks back at the dark token `rgb(193, 194, 197)` with the
    plain `<p>` beside them still at `rgb(230, 230, 230)`. Dark is where that
    reads, a soft grey token against a near-white block colour. Light behaves the
    same: `color: rgb(24, 24, 27)` on `<body>` gives `rgb(24, 24, 27)` where the
    token `rgb(34, 34, 34)` used to win. Every in-repo consumer is in that
    population, by two routes — four starters set the colour on `<body>` with
    Tailwind (`text-zinc-900 dark:text-zinc-100`), and seven set it on a
    `[data-theme]` root as `#1a1a1a` / `#e6e6e6` (`civitai-block-starter` plus the
    six apps under `starters/examples/`). The package's own `demo/` and
    `playground/` still show the token, but by inheriting it from
    `body { color: var(--civitai-color-text) }` rather than because Text names it.
    With no colour anywhere Text lands on the UA default `rgb(0, 0, 0)`,
    `@civitai/theme` shipping tokens and no `color`. `ci-text-default` asks for the
    token explicitly — see the `utilities.css` note below for what has to be loaded
    for that class to do anything.
    This ships `minor` on two published packages, so adding the axis later stays
    additive while taking it away would not be.
  - **Margins are reset to `0`.** The UA's heading/paragraph margins are
    em-relative, so they would move with every `data-size`; vertical rhythm here
    belongs to `stack`/`group`. It is also what makes the two tracks lay out
    identically.

  **Tokens: nothing new — and 🔴 Text references no colour token in any declaration
  of its own.** `@civitai/theme` exposes `--civitai-font` and `--civitai-font-mono`
  and no size, weight or leading scale — Mantine expresses those per component — so
  Text adds no token and states its px scale in `MARKUP.md` as a table, the way
  every other component in this sheet states its metrics. What it does _not_ do is
  read `--civitai-color-text`: both tracks are `color: inherit`, so overriding that
  token does not retheme Text on its own. Measured — with
  `--civitai-color-text: rgb(200, 0, 0)` on a wrapper, both tracks compute
  `rgb(0, 0, 0)` (the inherited page colour), and only adding `ci-text-default`
  moves them to `rgb(200, 0, 0)`. The token still reaches Text, but by inheritance
  from an ancestor that paints with it, or through a `ci-text-*` utility — not
  because Text names it.

  **Deliberately NOT in v1** — each already has an implementation one layer down,
  and one predicate decides all three: **colour** → `ci-muted` / `ci-text-*`,
  **alignment** → `ci-text-start` / `ci-text-center` / `ci-text-end`,
  **truncation** → `ci-truncate`. `color` and `text-align` inherit, so the first
  two reach `<civitai-text>` as well; `overflow` does not, so truncation on the
  element track is a real follow-up rather than an oversight. Adding any of them
  later is additive; removing one would not be.

  ⚠️ **Colouring Text requires `utilities.css`, which is a separate stylesheet — and
  no injection path in these packages ships it.** It is not bundled into
  `styles.css`; `injectStyles()` injects the tokens and `styles.css` only, and
  `@civitai/blocks-react`'s `injectBlocksStyles()` — reached on mount by 20 of the
  21 component modules in that package's `/ui`, `SettingsForm` being the one
  exception and deliberately unstyled — adds that package's interactive CSS on top
  and still no utilities. So an App Block author who hand-writes
  `<p data-civitai-ui="text">`, which rendering a `/ui` component is documented to
  style, gets the new inherit behaviour together with a
  `ci-text-default` that silently does nothing: measured, that markup under an
  ancestor `color: rgb(24, 24, 27)` with `injectStyles()` alone computes
  `rgb(24, 24, 27)`, the class having no effect. Load
  `@civitai/components/utilities.css` alongside `styles.css` if you colour, align or
  truncate text. `demo/index.html` links all three.

  **Both tracks — a choice, not a rule.** Most elements in this package have no
  attribute-track twin, so "every other component ships both" would be false; the
  relationship that holds is the converse (nearly every attribute slug also has an
  element). Text ships both to stay on the side of that pattern and of a published
  consumption mode.

  Additive: no existing component, attribute, token or export changes behaviour.

### Patch Changes

- Updated dependencies [4aa3a9f]
  - @civitai/components@0.8.0

## 0.7.0

### Minor Changes

- c49ade1: `<civitai-workflow-button>` prices a workflow, runs it on the viewer's Buzz and
  reports it — as one control. The price is in its label before a press; while it
  runs it spins, names the stage the workflow is at, says how many jobs are ahead
  of it while a step still waits in a queue, counts its steps off as they
  finish and fills its own background with the lowest progress rate any step
  reports; a second press asks whether to cancel,
  offering the workflow id to copy. A finished run
  says how it ended before the button offers its price again. A metered workflow,
  billed as it runs, is offered without a price rather than as free. It
  emits `priced`, `submitted`, `progress`, `finished`, `canceled` and `error`, so
  an app stops rebuilding submit-watch-cancel around every generate button.

  `variant`, `size`, `full-width` and `disabled` pass through to the button it
  wraps, so an app never needs `::part` CSS for what a plain button already does.

  Like `<civitai-sign-in-button>` it needs `@civitai/sdk` (an optional peer) and
  sits behind its own entry point, out of `register` and the CDN bundles.

### Patch Changes

- Updated dependencies [c49ade1]
- Updated dependencies [c49ade1]
  - @civitai/components@0.7.0

## 0.6.0

### Minor Changes

- f84cf81: `<civitai-video>` and `<civitai-audio>`, siblings of `<civitai-image>` that
  follow HTML's own three media elements, and the states a generated file goes
  through, now on all three:

  - `pending` while the file is still being made: a loader, and nothing requested.
  - `blocked` when it is withheld from the viewer: the `blocked` slot says why,
    and the file is never requested.
  - `fallback` when it fails to load, which is how an expired signed URL shows up;
    listen for `error` to hand it a fresh `src`.

  `status` gains `blocked` alongside `loading`, `loaded` and `error`, and `load`
  and `error` still do not bubble, matching the media events they stand in for.

  `openable` turns an image, or a `preview` video, into a real button that emits
  `open`, so a gallery opens a viewer from the keyboard as well as a click. A
  `preview` video plays muted and looping, without controls, while hovered or
  focused; any other video keeps its native controls. `--civitai-media-max-height`
  caps the height of an image or a video.

  `<civitai-image>` is unchanged unless these are used: same parts, events and
  look, and its parity test against the legacy markup still passes.

  React: `CivitaiVideo` (`onVideoLoad`, `onVideoError`, `onOpen`), `CivitaiAudio`
  (`onAudioLoad`, `onAudioError`), and `onOpen` on `CivitaiImage`.

### Patch Changes

- Updated dependencies [f84cf81]
  - @civitai/components@0.6.0

## 0.5.0

### Minor Changes

- 266a021: Three more: `<civitai-button-group>`, `<civitai-input-group>` and
  `<civitai-confirm-dialog>`.

  The two grouping elements are **light DOM**, for a reason worth recording:
  joining controls means reaching their `::part(button)` and `::part(control)`,
  and a part crosses exactly one shadow boundary. From the document those parts
  are reachable; from a shadow root the controls had been slotted into they are
  not. So the grouping element styles children the page owns.

  `<civitai-confirm-dialog>` extends `<civitai-modal>` — the focus trap, the top
  layer and Escape all come from one implementation, and the modal grew two
  render hooks for it. `await dialog.ask()` resolves `true`, `false` on cancel,
  and `false` on a dismissal, so a caller is never left waiting on a promise that
  will not settle. A destructive confirmation lands focus on Cancel.

  The React binding map now follows the superclass chain. That fixed a gap nobody
  had noticed: `<civitai-switch>` extends `<civitai-checkbox>` rather than the
  field base directly, so it had been generated **without** `onChange` or
  `onInvalid` despite dispatching both.

- 266a021: Add `@civitai/components-react/elements` — React bindings for the custom
  elements.

  `ButtonElement`, `TextInputElement` and `SegmentedControlElement` are separate
  from the existing `Button`/`TextInput`/`SegmentedControl`, which keep rendering
  the attribute markup. Nothing an existing consumer imports changes, and the `.`
  entry still reaches neither Lit nor an element module — a test asserts it.

  Props are assigned as properties after mount rather than left to React's own
  prop handling. React decides between attribute and property by whether the
  element has upgraded yet, so an un-upgraded element takes a boolean as the
  string `""` and Lit's converter never runs — `loading` would be truthy but not
  `true`. Assigning directly behaves the same on React 18 and 19, and is the only
  way to pass the segmented control's `data` array at all.

- 266a021: React bindings for all 32 elements, built on `@lit/react`'s `createComponent`
  instead of hand-written wrappers. It derives the props AND their types from the
  element class, forwards refs to the element instance, and always assigns
  properties rather than attributes — which is the React 19 behaviour the previous
  wrappers had to work around by hand.

  Each binding is its own module, so importing `@civitai/components-react/elements/civitai-button`
  reaches that element and nothing else; the `./elements` barrel registers all of
  them and is the convenient-but-larger path.

  Breaking within this unreleased entry point: the wrappers are named after their
  tags (`CivitaiButton`, not `ButtonElement`) and handlers receive the DOM Event
  rather than an extracted value — `onChange={(e) => e.target.value}`,
  `onVote={(e) => e.detail}`.

- 266a021: `<civitai-image>` is bindable: `onImageLoad` and `onImageError`. They are not
  called `onLoad`/`onError` because React wires those itself on any host element,
  so sharing the name would run the handler twice.

  `onSelect` on `CivitaiMenu` is typed with `MenuSelectDetail` now that the event
  carries a value rather than a DOM node.

  Which elements get `onChange`/`onInvalid` is read off the field base rather than
  listed by hand, so a control that joins that base cannot silently miss them —
  which is exactly what happened to the checkbox, radio group and segmented
  control in this release.

- 266a021: Five elements a real consumer needed and the vocabulary had no answer for.

  `<civitai-switch>` **extends** `<civitai-checkbox>` rather than restating it —
  the payoff from folding every control onto one field base last release, since
  the form participation, validity and error chrome all arrive for free and
  `role="switch"` is the only difference that matters.

  `<civitai-progress>` drops `aria-valuenow` entirely when `indeterminate`,
  because a bar that does not know its extent should not claim one.
  `<civitai-pagination>` keeps the first and last page either side of an ellipsis
  so the buttons do not move under the pointer as you page, and emits `change`.
  `<civitai-breadcrumb>` renders its separator as a pseudo-element, which is what
  keeps it out of the trail a screen reader reads.

  `<civitai-table>` is **light DOM on purpose**: a slotted `<tr>` inside a shadow
  `<table>` leaves the table formatting context and stops being a row. It styles a
  table the page already owns, so it works over a data grid's generated markup
  instead of asking anyone to give up sorting and virtualization.

  The CDN bundle budgets move to 32 kB and 38 kB gzip. No element is an outlier
  to shave — an all-in-one bundle simply grows with the vocabulary, and a page
  that counts bytes imports `@civitai/components/<tag>/define` instead.

- 266a021: `<civitai-nav-list>` and `<civitai-nav-item>` — navigation primitives rather
  than an app shell, because the reusable part of a sidebar is the nav tree's
  behaviour and not the chrome around it. Lay the page out with the utilities.

  `current` on the list is an `href`, matched exactly. It marks that item and
  opens every group above it, however deep — the part sidebars usually get
  wrong, landing on a nested route with the section containing it still
  collapsed. An item is a link when it has an `href` and a disclosure when it
  has children; an `href` _with_ children is still a disclosure, never an anchor
  that also toggles. Depth is counted by the item itself, so nesting indents
  without anyone tracking levels in markup.

  Icons stay slotted. The package ships no icon set, so an app brings its own and
  pays for nothing it does not use.

### Patch Changes

- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
  - @civitai/components@0.5.0
  - @civitai/theme@0.4.0

## 0.4.3

### Patch Changes

- bcc24bf: Publish first-party deps as caret ranges instead of exact pins, and stop shipping sourcemaps that cannot resolve their sources (#374, #376).

  **#374 — exact inter-package pins duplicated `@civitai/theme` and `@civitai/components`.**
  `@civitai/components`, `@civitai/components-react` and `@civitai/blocks-react` declared
  their first-party deps as `workspace:*`. pnpm rewrites the workspace protocol at pack
  time, and `*` publishes an **exact** pin — measured off the real tarballs:
  `@civitai/components@0.4.2` shipped `"@civitai/theme": "0.3.1"`, not `"^0.3.1"`.

  Two exact pins from two different releases can never intersect, so co-installing
  adjacent releases produced duplicate physical copies. Measured outside this workspace
  with a real `npm install --package-lock-only` over a closed registry built from the
  actual packed tarballs — an app on `@civitai/components-react@0.4.0` that also pulls
  `@civitai/blocks-react@0.56.1`:

                before   @civitai/theme       0.3.0 (nested) + 0.3.1  — 2 copies
                         @civitai/components  0.4.0 (nested) + 0.4.2  — 2 copies
                after    @civitai/theme       0.3.1                   — 1 copy
                         @civitai/components  0.4.2                   — 1 copy

  That is not only bloat. `injectTokens()` is DOM-marker idempotent and **first copy
  wins**, so the first token bump that changes a _value_ would have shipped stale tokens
  underneath new component CSS — silently, and only in the duplicated install.

  The three manifests now use `workspace:^`, which publishes `^<version>`.

  **Scope of the fix, stated rather than implied.** `^` on a `0.x` version locks the
  minor, so this removes duplication across patch-adjacent releases only. Measured at
  the second point too: an app on `@civitai/components-react@0.3.1` (theme `0.2.1`)
  alongside `@civitai/blocks-react@0.56.1` (theme `0.3.1`) still resolves 2 copies,
  before and after. That is correct and deliberate — a `0.x` minor is a breaking change
  under this repo's own convention, so those two releases genuinely disagree about which
  theme they need, and widening the range to `>=x.y.z <1.0.0` would trade a duplicate
  copy for an incompatible pairing of component CSS with theme tokens.

  One consequence worth knowing at release time: because `^0.3.1` already admits
  `0.3.2`, `changeset version` no longer cascades a re-release of every dependent on a
  theme patch bump (verified against both manifest shapes — with `workspace:*` a theme
  `0.3.1 → 0.3.2` bump dragged `@civitai/components` and `@civitai/components-react` to
  `0.4.3`; with `workspace:^` it leaves them at `0.4.2`).

  **#376 — every shipped sourcemap dangled.**
  All five packages build with `sourceMap` + `declarationMap`, so `dist/` fills with
  `*.js.map` and `*.d.ts.map` whose `sources` point at `../src/*.ts`. No package lists
  `src` in `files`. Measured off the real packed file lists at the previous state: **270
  shipped maps, 270 dangling source references, zero resolvable** — `@civitai/blocks-react`
  160, `@civitai/app-sdk` 46, `@civitai/components-react` 48, `@civitai/theme` 12,
  `@civitai/components` 4. A consumer's devtools loaded each map and then had nothing to
  show.

  The maps are now excluded from the tarballs (`"!dist/**/*.map"`) and still emitted into
  `dist/`, where they are _not_ dangling — inside this repo `src` sits right beside them,
  so go-to-definition from a starter still lands in the real `.ts`. **No consumer
  debuggability is lost, because there was none.** Shipping `src` instead was measured
  and rejected: `packages/civitai-blocks-react/src` alone is 879,895 B, in a package
  whose design constraint is that every app inherits its install graph.

  Tarball delta across the five packages: **−114,574 B gzipped, −580,786 B unpacked**
  (`@civitai/blocks-react` alone: −77,441 B gzipped, −413,492 B unpacked).

  Enforced going forward by `scripts/check-shipped-sourcemaps.mjs` (`pnpm
check:shipped-sourcemaps`), which reads the real packed file list and every real map's
  `sources` rather than grepping for the `files` entry — so shipping `src` or inlining
  `sourcesContent` satisfies it equally.

- Updated dependencies [bcc24bf]
  - @civitai/components@0.4.3
  - @civitai/theme@0.3.2

## 0.4.2

### Patch Changes

- Updated dependencies [e06173f]
  - @civitai/components@0.4.2

## 0.4.1

### Patch Changes

- Updated dependencies [ee25ac9]
  - @civitai/components@0.4.1
  - @civitai/theme@0.3.1

## 0.4.0

### Minor Changes

- 393d9a1: Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

  ⚠️ **Upgrading — one visible layout change.** A `group` row now **wraps** instead of overflowing, and its children may shrink. If you relied on a group staying on one line — a deliberately horizontal-scrolling toolbar, for example — add `data-nowrap="true"` to restore the previous behaviour:

  ```html
  <div data-civitai-ui="group" data-nowrap="true">…</div>
  ```

  This affects bare markup and `@civitai/components-react`'s `<Group>`. `@civitai/blocks-react`'s `<Group>` is unchanged — it already wrapped.

  **`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

  There are **three** `group` surfaces, and they did not agree:

  - `@civitai/blocks-react`'s `<Group>` defaults `wrap = true` and writes `flex-wrap` as an _inline_ style — its consumers have always wrapped;
  - `@civitai/components-react`'s `<Group>` writes no inline style at all and has no `wrap` prop, so it resolved against the CSS;
  - bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve — likewise.

  The CSS carried no `flex-wrap`, so the latter two did not wrap. Nothing could see it, because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 320px box**. They now reflow onto two rows and fit, and a test pins the CSS default against the rendered React default so they cannot drift apart again.

  **Be precise about what this is:** for `blocks-react` it aligns the CSS to a default that was already shipping, but for `@civitai/components-react` and for bare markup it is a genuinely **new default**.

  `min-width: 0` lets one long unbroken label narrow instead of pushing the whole row past its container. It applies to a child with the default `overflow: visible`; per CSS Flexbox §4.5 a child with any other `overflow` already has an automatic minimum size of 0.

  **`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

  Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

  ***

  **Bump level: `minor`, decided — not an open question.**

  An adversarial audit recommended `major` for `@civitai/components`, on the grounds that `RELEASING.md` reserves it for "a behavior change that existing callers will notice" and this change is justified precisely by the fact that they do notice (436px of overflow becomes two rows). That reading is sound; it was considered and **the maintainer chose `minor`**, since publishing `@civitai/components@1.0.0` off `0.3.1` is a product decision rather than a correctness one.

  Recorded so a later reader knows this was weighed rather than missed, and so the trade-off is visible: shipping as `minor` means **this changelog entry is the only warning consumers get**, which is why the upgrade note is at the top rather than buried here. The concrete case it exists for is a published App Block rendering bare `data-civitai-ui="group"` as a deliberately horizontal-scrolling toolbar — that starts wrapping, and `data-nowrap="true"` is the one-attribute fix.

### Patch Changes

- Updated dependencies [73412e3]
- Updated dependencies [393d9a1]
  - @civitai/theme@0.3.0
  - @civitai/components@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [77ce989]
  - @civitai/components@0.3.1
  - @civitai/theme@0.2.1

## 0.3.0

### Minor Changes

- 6b0a2e6: Add five new UI primitives so App Blocks stop hand-rolling them: **Slider**,
  **SegmentedControl / Tabs**, **Toast**, **Tooltip**, and **Image**.

  Each ships in both consumption forms — framework-agnostic
  `data-civitai-ui="…"` markup (styled by `@civitai/components`, contract in
  `MARKUP.md`, all rules inside `@layer civitai.components`, token-driven via
  `--civitai-*`) and an ergonomic `forwardRef` React binding in
  `@civitai/components-react`. The interactive ones carry real behavior in the
  React binding:

  - **Slider** (`data-civitai-ui="slider"`) — themed native `<input type="range">`
    with label/description/error field wiring, invalid state, and an optional live
    value read-out (also mirrored to `aria-valuetext` for screen readers).
  - **SegmentedControl / Tabs** (`data-civitai-ui="segmented-control"` +
    `TabPanel`) — WAI-ARIA **roving tabindex** + **arrow-key / Home / End
    navigation** (selection follows focus) in two role modes: `'toggle'` (default)
    = `role="radiogroup"`/`role="radio"` for a panel-less value switch, and
    `'tabs'` = `role="tablist"`/`role="tab"` with `aria-controls` ⇄
    `aria-labelledby` tab-panel semantics.
  - **Toast** (`ToastProvider` + `useToast`, presentational `Toast`,
    `data-civitai-ui="toast-region"`) — an `aria-live` notification host with a
    queue, auto-dismiss timers, and intent colors.
  - **Tooltip** (`data-civitai-ui="tooltip"`) — a hover/focus `role="tooltip"`
    bubble with `aria-describedby` wiring and real Escape-to-dismiss (a
    `data-dismissed` flag overrides the CSS reveal even while hovered/focused).
  - **Image** (`data-civitai-ui="image"`) — a media container with a token
    placeholder background, `object-fit` control, and broken-image fallback
    driven by `data-status`.

  Covered by probe-oracle styling anchors, HTML⇄React computed-style parity, and
  axe a11y checks (keyboard nav for SegmentedControl, `aria-live` for Toast).

### Patch Changes

- Updated dependencies [6b0a2e6]
  - @civitai/components@0.3.0

## 0.2.1

### Patch Changes

- cce1716: Patch release (0.2.1) — implement the documented component defaults in the base CSS.

  `MARKUP.md` documents a default `data-variant` / `data-size` / `data-color` for several components, but `@civitai/components` gated **all** of that styling on an **explicit** attribute — so a bare element (including MARKUP's own minimal examples) rendered unstyled or zero-size. This was a doc-vs-code mismatch: the docs were correct; the CSS did not match them.

  The documented defaults now live on the unconditional **base** rule, so bare markup (`<span data-civitai-ui="badge">`, `<button data-civitai-ui="button">`, a bare alert / loader) renders the documented default; the explicit `data-variant` / `data-size` / `data-color` rules still **override**.

  **Components that had the gap (now fixed):**

  - **Badge** — no default variant (`filled`) or size (`md`): a bare badge had no padding and no fill. Now renders filled + md.
  - **Button** — no default size (`md`): a bare button had no height/padding. The base filled default is also completed (`border-color` + hover).
  - **Alert** — no default color (`info`): a bare alert rendered neutral chrome instead of the documented info intent (tinted bg + border). Now renders the info intent.
  - **Loader** — no default size (`md`): a bare loader was `0×0` (invisible). Now renders the 22px md spinner.

  Badge's `light` variant now resets `border-color: transparent` explicitly (it previously relied on the base transparent border, which the fix changes to primary) — light badges are visually unchanged. **No documented default was changed** — the CSS was made to match the docs, not vice versa.

  The `@civitai/components-react` bindings are behaviorally unchanged (they already emit explicit attributes; the CSS defaults benefit hand-written HTML consumers) and get the patch as the lockstep React binding of `@civitai/components`.

- Updated dependencies [cce1716]
  - @civitai/components@0.2.1

## 0.2.0

### Minor Changes

- b896dd9: Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

  **F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card _without_ `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

  **F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

  **F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.

### Patch Changes

- Updated dependencies [b896dd9]
  - @civitai/theme@0.2.0
  - @civitai/components@0.2.0

## 0.1.2

### Patch Changes

- 5a210cb: Design-system 0.1.2 — two retrofit-dogfood fixes (civitai/civitai-app-starters#181).

  - **Badge `data-color` (F2):** Badge now accepts an intent color mirroring
    Alert's `data-color` contract (`info` / `success` / `warning` / `error`),
    recoloring the `filled` / `light` / `outline` variants via the same
    `color-mix()` token approach. `@civitai/components-react` `<Badge>` gains a
    `color` prop mapped to `data-color`. Omitting it keeps the current primary
    accent, so the change is non-breaking.
  - **Dark `--civitai-color-primary-fg` (F8):** the generated
    `[data-theme='dark']` token block now emits `--civitai-color-primary-fg`
    (white) for symmetry with light. It is produced by the `@civitai/theme` token
    pipeline (not hand-authored), so generation-parity holds; light is unchanged.

- Updated dependencies [5a210cb]
  - @civitai/theme@0.1.2
  - @civitai/components@0.1.2

## 0.1.1

### Patch Changes

- b61eb57: Fix design-system onboarding papercuts found by a blind dogfood (lockstep 0.1.1).

  - **CDN styles.css now resolves on any CDN.** `@civitai/theme` and
    `@civitai/components` ship a real package-root `styles.css` file (built from
    `dist/`), so a literal path like
    `cdn.jsdelivr.net/npm/@civitai/theme@0.1.1/styles.css` resolves — jsDelivr
    ignores package.json `exports`, so the `./styles.css` export alias alone 404'd
    there. The `exports` alias still works for bundler imports.
  - **Docs CDN URLs fixed** — every README + `MARKUP.md` now uses pinned,
    resolvable jsDelivr URLs.
  - **Markup contract inlined** into the `@civitai/components` README (the
    relative `MARKUP.md` link 404'd on npmjs.com); `MARKUP.md` stays canonical.
  - **Servable `demo/index.html`** now ships in the `@civitai/components` tarball —
    a complete copy-paste plain-HTML page (CDN links, one of every component, a
    light/dark `data-theme` toggle, page theming via `--civitai-color-body`).
  - **New `--civitai-color-body` token** in `@civitai/theme` (derived from
    Mantine's `--mantine-color-body`: `#fefefe` light / `#1A1B1E` dark) — a
    page-background token for plain-HTML apps.

- Updated dependencies [b61eb57]
  - @civitai/theme@0.1.1
  - @civitai/components@0.1.1
