# @civitai/components

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

- 266a021: The image card, in parts: `<civitai-media-card>` (media plus `top-start`,
  `top-end` and `bottom` overlay slots over a scrim), `<civitai-reaction>`
  (emoji, abbreviated count, pressed state, emits `react`) and
  `<civitai-action-button>` (a circle that expands to its label on hover or
  focus, crossfading to a second icon in an inverted chip when it opens).

  Two details that are easy to get wrong and are pinned by tests: the overlays are
  SIBLINGS of the media link rather than children, because a menu button inside an
  anchor is invalid and unreachable by keyboard; and a control sitting on the media
  takes its contrast from the image, not the page, so the card overrides it to the
  scheme-independent ramp instead of letting it follow the theme.

  The `top-end` corner stacks vertically, since that is where the site hangs the
  action button under the kebab; `top-start` and `bottom` stay rows.

  Counts read the way civitai.com's own `abbreviateNumber` writes them —
  `13100` is `13.1k`, uppercased in CSS.

- 266a021: The utility layer is no longer in a cascade layer. A layered rule loses to any
  unlayered one regardless of specificity, so every `ci-*` class silently lost to
  legacy CSS it exists to beat — measured against Bootstrap's reboot, `ci-mt-6`
  computed to `0px`. Components stay layered, so consumers can still override
  those. Adds `ci-border-bottom` and `ci-border-end`.
- 266a021: Publish a CDN bundle and the custom-elements manifest.

  `elements.js` at the package root makes the one-script-tag form work: jsDelivr
  ignores `exports`, so a subpath like `/register` 404s there — the same reason
  `styles.css` is copied to the root. The build fails over **25 kB gzip**, which
  is the budget the whole element set has to live within; three elements plus Lit
  and the tokens currently come to about 11 kB.

  `custom-elements.json` is the published contract — tags, attributes,
  properties, parts and slots. It is derived from the element sources rather than
  JSDoc: tag names come from `defineElement(TAG, …)`, parts and slots from the
  Lit templates. Nothing is restated, so nothing can drift, and a test fails if
  the manifest stops matching what the package registers.

- 266a021: Fields take `size`. `<civitai-button>`, `<civitai-badge>`, `<civitai-loader>`
  and `<civitai-segmented-control>` all had `sm | md | lg`; no field did, so a
  toolbar could not put a select next to a small button without them disagreeing
  about height. `CivitaiField` carries it now, which is every text input,
  textarea, number input, select and slider at once.
- 266a021: Add `<civitai-image>` and `<civitai-slider>`.

  `<civitai-image>` tracks `loading` / `loaded` / `error` and reflects it, so
  `:host([status='error'])` and a consumer's own CSS can both see the state. It
  reconciles from the element after render as well as from `load`/`error`, because
  a cached image can already be `complete` before the listeners attach and fire
  neither.

  `status` is the reliable contract and the `load`/`error` events are the
  convenience on top: a cached image settles immediately, so a consumer attaching
  a listener after mount can miss the event entirely.

  `<civitai-slider>` is a themed native range — arrow keys, Home/End and
  `aria-valuenow` all come from the control rather than being reimplemented — with
  the value read-out, description and error wired through the shared field base.

  An unset range is not empty: the browser parks it at the midpoint of min/max.
  The element now derives that before rendering, so its value, its read-out and
  `FormData` agree with what is on screen instead of reporting `''`.

- 266a021: Add `<civitai-menu>` with `<civitai-menu-item>` and `<civitai-menu-label>` — the
  kebab popup the site uses on tags and on the image toolbar. It sits in the top
  layer via the Popover API, which is what lets it escape a clipping ancestor;
  arrow keys walk the items, Escape and a choice both return focus to the trigger,
  and a disabled item is announced rather than skipped.

  `<civitai-tag>` gains `confidence` (0–1 from the tagger), drawn as a bar behind
  the label and tinted with the rating. It is separate from `score`, which is the
  vote total.

- 266a021: `<civitai-modal>` answers `show()`, `hide()` and `toggle()`, the same three
  `<civitai-menu>` already had. Setting `open` still works; this is only so the
  two do not disagree about how a box is opened.

  The README gains the four authoring rules an API review had to reconstruct:
  when content is a property and when it is a slot, that parts are named after
  the property that fills them, why no element needs `exportparts`, and that
  visibility is a property with the methods as sugar.

- 266a021: Add `<civitai-modal>` and `<civitai-collapse>`.

  `<civitai-modal>` is built on native `<dialog>.showModal()`, so the focus trap,
  the top layer, the inert background and focus restore all come from the
  platform. The React binding it replaces documents the opposite — _"this does
  NOT trap focus inside the panel — Tab can still reach content behind the
  overlay"_ — so this is a strict accessibility upgrade rather than a port.

  It also sidesteps two risks the plan flagged: nothing is portalled to
  `document.body` (the top layer needs no z-index or portal), and nothing reads
  `document.activeElement` to restore focus, which returns the host rather than
  the focused inner node.

  Escape is honoured through the dialog's `cancel` event, so `close-on-escape`
  turns it off by preventing the default rather than by swallowing the key.

  Both elements name their label `heading`, not `title`: `title` is a global
  attribute and would render a browser tooltip over the whole component.

- 266a021: Add `<civitai-sign-in-button>`, the first element that acts as the viewer
  through `@civitai/sdk`. Inside a civitai.com page it asks the host, and is
  inert until `BLOCK_INIT`: with no validated host origin a press sends nothing,
  and the control renders disabled. Given a `signIn` from the SDK's
  `createSignIn()`, the same button leaves for Civitai itself, so an app outside
  civitai.com gets one button for both.

  It has its own entry points, `@civitai/components/civitai-sign-in-button` and
  `/define`, and is left out of `register`, `elements.js` and `site-elements.js`,
  so a page that wants only the look never bundles the SDK. `@civitai/sdk` is an
  optional peer dependency: install it only to use this element.

- 266a021: Add the first civitai.com vocabulary elements: `<civitai-avatar>` (initials
  fallback, cosmetic frame), `<civitai-rating-badge>` (the `g`/`pg`/`pg13`/`r`/`x`
  ladder, spelled as the site already spells it) and `<civitai-tag>` (the votable
  tag pill, emitting `vote` with `{ name, vote }`).

  They ship in a second CDN bundle, `site-elements.js`, which is the generic kit
  plus these — load one bundle or the other, never both. Two disjoint bundles
  would each carry their own 8.5 kB of Lit, and a page with a tag in it wants
  buttons too.

  These elements are presentational: state in as attributes, intent out as an
  event. Nothing here talks to the host.

- 266a021: Add `<civitai-checkbox>` and `<civitai-radio-group>`.

  `<civitai-radio-group>` owns the whole set and renders its radios from a `data`
  property, rather than coordinating slotted children the way the React binding
  does. Native `name`-based exclusion is **tree-scoped**: radios in sibling shadow
  roots never group, so two could be checked at once and arrow keys would not move
  between them. Keeping them in one root keeps exclusion, roving focus and ARIA
  native instead of reimplemented.

  That means there is no standalone `<civitai-radio>` element. A lone radio that
  cannot group with its siblings is a trap, and the group covers the real use.

  `<civitai-checkbox>` submits its value only when checked, defaults that value to
  `on`, and carries `indeterminate` — which is a property with no attribute on a
  native checkbox, so it is set imperatively after each render.

  Neither `checked` nor `indeterminate` is reflected. The `checked` ATTRIBUTE is
  the default `form.reset()` returns to, exactly as on a native checkbox, so
  writing live state back to it would make reset a no-op. This is the third
  element where reflecting the value-ish property broke reset, and every
  form-associated element now has a test pinning it.

- 266a021: A utility layer, at `./utilities.css`. Elements cover the components; they
  cannot cover the markup between them — the row, the gap, the margin — and this
  package had no answer for that, so every hand-HTML author wrote their own. An
  API review put a number on it: of the 205 Bootstrap classes one real consumer
  uses, **135 are layout and spacing**, none of which an element can replace.

  217 classes under a `ci-` prefix, generated from `src/utilities.spec.ts` and
  spending the same tokens the elements do: colour utilities name
  `--civitai-color-*` rather than a shade, so they follow the theme into dark
  mode. Spacing is a scale of its own, `--civitai-space-0` through `-6`, because
  Mantine expresses spacing per component and `@civitai/theme` has nothing to
  derive a ramp from. The grid is CSS Grid rather than floats or percentages.

  `./bootstrap-compat.css` ships alongside it and is **transitional**: Bootstrap's
  own class names mapped onto the same declarations, keeping Bootstrap's
  breakpoints rather than ours, so a page adopts the tokens before it touches its
  markup. A browser test asserts all 214 aliases compute identically to the `ci-`
  utility behind them, which is what makes deleting a rule safe once its markup
  moves.

- 266a021: `<civitai-text-input>` and `<civitai-textarea>` take `maxlength` and
  `autocomplete` and hand them to the control, which is where the UA reads them.
  Both were missing, and `civitai-brawl` needed all three of its lobby inputs
  capped when it adopted the elements.
- 266a021: One field contract, not four. `<civitai-checkbox>`, `<civitai-radio-group>` and
  `<civitai-segmented-control>` each carried their own `ElementInternals` plumbing;
  `<civitai-slider>` re-rendered the label, description and error chrome by hand.
  All four now sit on `CivitaiField`, which grew three hooks for the cases that
  genuinely differ — `formValue()`, `missing` and `missingMessage`.

  The visible part: `<civitai-segmented-control>` gains `label`, `description`,
  `error`, `required` and `disabled`, with the `label` and `error` parts and the
  `reportValidity()` the others already had. Previously `required` on it set no
  validity at all, so a form submitted regardless. Checkbox and radio group gain
  `reportValidity()`.

  **Breaking — `select` carries a value, not an element.** `<civitai-menu>`'s
  `select` detail was `{ item: HTMLElement }`, which no framework outside the DOM
  can receive: it cannot be serialized to Blazor, and React handlers had to read
  `textContent` back off the node. It is now `{ value: string }`, and
  `<civitai-menu-item>` takes a `value` attribute that falls back to the item's own
  text the way an `<option>` does.

  **Breaking — two parts renamed.** `part="title"` on alert, modal and toast is now
  `part="heading"`, matching the property that fills it. `part="trigger"` on
  collapse is now `part="button"`, matching every other element that renders one.

  `<civitai-tabs>` marks `change` `composed`, so it escapes a consumer's shadow
  root rather than stopping at it. `<civitai-image>` dispatches `load` and `error`
  under literal names; the computed one left `custom-elements.json` with an event
  that had no `name` field, and the manifest now describes all 11 events.

- 266a021: Add custom elements: `<civitai-button>`, `<civitai-text-input>` and
  `<civitai-segmented-control>`.

  Behaviour has only ever existed in the React layer — `MARKUP.md` tells
  hand-HTML authors to implement the segmented control's keyboard handling
  themselves — so the two Svelte starters got a stylesheet and homework. These
  elements carry the behaviour with the style, identically in plain HTML, Svelte,
  Vue and React.

  New entry points, all additive: `./register`, `./<tag>`, `./<tag>/define` and
  `./internals`. `./styles.css` and the `.` entry are untouched, and the `.` entry
  still pulls no renderer, so nothing an existing consumer imports changes.

  All three are form-associated, which gives back what a control inside a shadow
  root otherwise loses: `type="submit"`/`type="reset"` on the button, `FormData`
  round-tripping and Enter-to-submit on the text input, and `form.reset()` on all
  of them. `change` is re-dispatched across the boundary, because it is
  `composed: false` and would otherwise never reach a consumer's listener.

  `<civitai-segmented-control>` implements the WAI-ARIA roving tabindex: the group
  is one tab stop, arrows wrap across enabled segments, Home/End jump to the ends,
  and selection follows focus. It is a `radiogroup` only — the React binding's
  `mode="tabs"` is deliberately absent, because a tab's `aria-controls` is an
  IDREF and an IDREF cannot reach a light-DOM panel from inside a shadow root.
  axe flags it, so tabs get their own element rather than a broken mode here.

  One deliberate difference from the React binding: `error` also makes the field
  _invalid_ (`setValidity({ customError })`), so a form will not submit while a
  message is showing. The React binding only draws it, which contradicts the
  `aria-invalid` it sets. Clear `error` when the problem is fixed.

  Computed-style parity against the attribute markup each element replaces is
  asserted across every variant, size and theme.

- 266a021: `<civitai-button>` takes `color` (`info | success | warning | error`), which
  recolours every variant by rebinding the primary accent, and `href`, which
  renders an anchor — navigation is a link whatever it looks like. A disabled
  link drops its `href` rather than navigating while looking inert.

  `<civitai-select>` refuses to shrink below its longest option; squeezed by a
  crowded toolbar row it clipped its own value. `<civitai-table>` reaches the
  button a sortable grid puts in its header, which inherits neither font nor
  colour and had stopped the header treatment dead.

- 266a021: Add `<civitai-toast>` and `<civitai-toast-region>`, completing the element set.

  `<civitai-toast-region>` owns the queue and the auto-dismiss timers, and renders
  its toasts as its **own light-DOM children**. An `aria-live` region announces
  nodes added to itself, so shadow content it rendered would not be announced.

  Its API is imperative, like the React `useToast()` it replaces:
  `region.show({ message, heading, color, duration, urgent })` returns an id;
  `dismiss(id)` and `clear()` take it away. A `duration` of `0` is sticky. Timers
  are cleared when the region is removed, so none fire against a detached element.

  `<civitai-toast>` is the presentational card and carries its `role` on the host
  — `status` normally, `alert` when urgent — because the role has to sit on the
  element the live region actually sees appear.

- 266a021: Port six presentational primitives to elements: `<civitai-card>`,
  `<civitai-stack>`, `<civitai-group>`, `<civitai-badge>`, `<civitai-loader>`
  and `<civitai-alert>`.

  Computed-style parity against the attribute markup each replaces is asserted
  across every variant, size, colour and both themes — 58 cases.

  Two fidelity fixes fell out of that. The shared `:host` baseline was setting
  `line-height: 1`, which the legacy `[data-civitai-ui]` rule never did, so
  every element whose counterpart inherited a line height was being relaid out;
  the baseline now carries exactly what that rule carries. And the loader's ring
  is the host's own box rather than an inline child's, so it keeps the legacy
  `inline-block` box instead of gaining descender space beneath it.

  `<civitai-alert>` names its heading `heading`, not `title`: `title` is a
  global attribute and would render a browser tooltip over the whole alert.

  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

- 266a021: Add `<civitai-textarea>`, `<civitai-number-input>` and `<civitai-select>`, on a
  shared field base.

  `CivitaiField` owns what every labelled control needs — ids, the
  `aria-describedby` wiring, validity, `form.reset()` semantics and the value the
  form sees — so each control spells out only itself. `<civitai-text-input>` moved
  onto it with no change to its behaviour; its existing tests passed untouched.

  `<civitai-number-input>` is a native `type="number"`, so the browser's spinners,
  arrow-key stepping and `min`/`max`/`step` all work rather than being
  reimplemented. `<civitai-textarea>` deliberately does NOT submit on Enter, since
  Enter is a newline there.

  `<civitai-textarea>` leaves `rows` at the native default of 2 rather than
  `blocks-react`'s 3. The two existing surfaces disagree, and the contract this
  element replaces is the attribute markup — picking 3 would resize every
  migrating textarea.

  `<civitai-select>` takes its options as a `data` property, since an attribute
  cannot carry them, and renders a placeholder as a disabled empty first option.

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

- 266a021: Add `<civitai-tooltip>`, `<civitai-tabs>` and `<civitai-tab-panel>`.

  All three render in the **light DOM**, which is the only way they can work.
  `aria-describedby` and `aria-controls` are IDREFs, and an IDREF cannot cross a
  shadow boundary — a bubble or a tablist rendered in a shadow root could never
  reference a trigger or a panel the author put in the page. axe proved it when
  `<civitai-segmented-control>` tried to carry a `tabs` mode; splitting them out
  is what that finding forced.

  Because there is no shadow root to render into, these are the only elements
  here that are not Lit components. Their styles are injected into the document
  once, scoped to the tag name so they cannot collide with the attribute CSS.

  `<civitai-tooltip>` joins an existing `aria-describedby` rather than replacing
  it, and Escape genuinely dismisses the bubble even while the pointer still
  hovers or focus is still inside — the reveal is gated on the dismissal flag,
  which clears on the next hover or focus.

  `<civitai-tabs>` implements the roving tabindex: one tab stop, arrows wrapping
  across enabled tabs, Home/End, and selection following focus. Only the selected
  panel is shown; the rest are `hidden`, so they leave the a11y tree and the tab
  order.

### Patch Changes

- 266a021: Add a cross-engine contract suite and a capability probe.

  The elements rest on a handful of platform features that do not degrade — a
  browser missing `ElementInternals` or constructable stylesheets does not render
  a worse button, it renders a broken one. `test:contract` probes each feature
  directly and names what breaks without it, then exercises the cross-engine
  surface: upgrade, token inheritance across the shadow boundary, form
  association, `change` escaping the shadow root, and `::part` reachability.

  It runs on chromium, firefox and webkit, as an **advisory** CI job. The cost
  there is the browser install rather than the tests — `playwright install
--with-deps` was measured wedging for over two hours on one commit — so three
  engines must not be able to block a PR. The chromium half already runs inside
  the required job, so nothing is checked only in the advisory one.

  Also guards against `:host-context()`, which has never shipped in Firefox. A
  runtime probe cannot see that we used it, only that a browser lacks it, so the
  guard reads the source instead.

- 266a021: Make every entry point importable with no DOM. `civitai-tooltip`, `civitai-tabs`
  and `civitai-toast-region` subclass `HTMLElement` directly, and a class body is
  evaluated at import — so `import '@civitai/components/register'` threw
  `ReferenceError: HTMLElement is not defined` in Node and took down any
  server-rendered app. Registration already no-opped without `customElements`;
  the class declaration did not. A test now imports all 34 entry points with no
  DOM present.
- 266a021: Express "gray in light, surface in dark" as tokens instead of descendant selectors.

  Four rules in `components.css` were written as `[data-theme='dark'] <descendant>`.
  An ancestor selector cannot cross a shadow boundary and `:host-context()` has
  never shipped in Firefox, so those four decisions were unreachable from a custom
  element. They are now `--civitai-card-border-width`, `--civitai-color-track`,
  `--civitai-color-segmented-bg` and `--civitai-color-media-placeholder`, which
  inherit into a shadow root like any custom property.

  Mantine has no variable carrying either side of these pairs, so `TokenSpec.source`
  and `.literal` now each accept a `{ light, dark }` pair resolved against its own
  scheme's variable map. `--civitai-card-border-width` is a width rather than a
  colour: dark removes the default hairline's box, and a transparent colour would
  leave 1px of it on every card.

  No visual change — computed styles are unchanged in both themes. Existing tokens
  and artifact bytes are untouched; the new tokens are appended.

- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
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
  - @civitai/theme@0.3.2

## 0.4.2

### Patch Changes

- e06173f: Slice `src/components.css` per component at build time, as internal artifacts. The build now also writes one standalone, layered stylesheet per `/* ----- Name ----- */` section to `dist/css/<slug>.css` (plus a JS-injectable string compiled from `src/css/<slug>.generated.ts`).

  **No public API change — `patch`, not `minor`.** These files are deliberately NOT declared in `exports`: `@civitai/components/css/button` does not resolve, and the package still exports exactly `.` and `./styles.css`. They are also excluded from the published tarball (`files` carries `"!dist/css"`) — they exist on disk for this repo's own measurement and for issue #358, and nothing else. Files on disk are reversible; an `exports` key on a published package is not, and nothing imports these yet. Whether to open the surface — and in what shape — is issue #358, which `pnpm measure:css-split` prices from these real artifacts. Treat `dist/css/*` as private, unstable and unpublished.

  **What the split is worth, stated for the right split.** A `@civitai/blocks-react/ui` Button bundle is 52,568 B, 95.4% of it stylesheet text. Over this package's slices (Button + Loader, which `ui/Button.tsx` imports) it is **26,556 B concatenated / 25,518 B merged** — roughly half. A further 12,038 B is reachable only if `@civitai/blocks-react` **also** splits its own `INTERACTIVE_STYLES` sheet (Modal, Select, Slider, Collapse, SegmentedControl, ResourceCard), which is a change nobody has made and which this package cannot make. The 14,518 B / 13,480 B figures quoted earlier were that combined number, not this split's. 🔴 **None of these savings is banked by this release.** Every figure below the 52,568 B baseline requires a consumer to import the per-component slices, and nothing does — the subpaths are unexported and the artifacts are out of the tarball. The only bundle any shipped code produces today is still the 52,568 B one; this release makes the alternative measurable, not available.

  **Reassembly is asserted byte-identical** against the source sheet before any artifact is written. Stated narrowly, because the guard was previously described as more than it is: that assertion proves the **partition arithmetic** of `sliceComponentsCss` + `composeSheet` — the pieces recompose to exactly the input. It does **not** prove the sheet was cut in the right places; an unrecognised section marker merges into the previous slice and reassembly stays perfect. A separate boundary guard counts the raw `/* ----- ` markers and pins that count against the number of sections, and that is what would catch it.

  `componentsCss`, `injectStyles()`, `dist/components.css` and the package-root `styles.css` are byte-identical to before and still carry the whole sheet, because `@civitai/blocks-react`'s `useBlocksStyles()` injecting the whole pack is a documented contract (`MARKUP.md`): rendering any one `/ui` component styles hand-written `data-civitai-ui="…"` markup elsewhere on the page. Nothing in `@civitai/blocks-react` changed.

## 0.4.1

### Patch Changes

- ee25ac9: Docs: drop the version from the copy-paste CDN `<link>` URLs, so the stylesheet
  a reader loads can never fall behind the contract the same file documents.

  `MARKUP.md`, both `README.md`s and `demo/index.html` pinned
  `@civitai/theme@0.2.0` and `@civitai/components@0.3.0`. Both still return **HTTP
  200** — jsDelivr serves every published version forever — so this never surfaced
  as a broken link. It served an old stylesheet, and each file had reached the
  point of contradicting itself. Measured on the CDN, with `@0.9.9` on both
  packages as the negative control (404, 50-byte body):

  - `theme@0.2.0/styles.css` — 200, 5,560 B, **zero** `--civitai-bp-*` tokens.
    `packages/civitai-theme/README.md` documents `var(--civitai-bp-md)` eleven
    lines above the link that pinned it, and the developer-docs responsive guide
    is written entirely against those tokens. `theme@0.3.0` ships all five
    (`xs`/`sm`/`md`/`lg`/`xl`), 5,826 B.
  - `components@0.3.0/styles.css` — 200, 28,042 B, **zero** `data-nowrap` rules,
    and `[data-civitai-ui='group']` with no `flex-wrap`. `MARKUP.md` documents
    `data-nowrap="true"` as the opt-out for the wrapping `group` that shipped in
    `components@0.4.0` (31,970 B, 2 `data-nowrap` rules). So a reader following
    the current markup contract got the pre-`0.4.0` overflow behaviour and an
    attribute with nothing behind it — no console error, no failed request.

  **Why unversioned rather than a bump to `@0.4.0`/`@0.3.0`.** A bump is the same
  defect rescheduled — `0.3.1` (77ce989) already did exactly that, and these four
  files were stale again one minor later. Nothing can catch it in-band: the two
  packages version **independently** and publish on separate changesets, and
  `MARKUP.md` is static prose shipped verbatim in `files` (npm → mirrored into
  developer.civitai.com), so no build step is in a position to rewrite the pin.
  Removing the version makes the rot structurally impossible instead of merely
  deferred: `cdn.jsdelivr.net/npm/@civitai/<pkg>/styles.css` tracks the `latest`
  dist-tag and resolves 200 on every CDN, because both packages already ship a
  real root `styles.css` for exactly this reason (jsDelivr ignores package.json
  `exports` — see the header comment on each build script).

  The trade-off is stated where it belongs and taken deliberately: unversioned
  means a future publish reaches a copy-pasted page unannounced. Pinned means the
  page silently renders documented markup unstyled, which is the failure that has
  actually happened, twice, and it fails in the direction that looks like the docs
  being wrong. Unversioned can only be _ahead_ of the docs — additive, so
  undocumented rules exist but nothing documented goes missing. Each file now says
  so at the point of copy-paste, and tells a reader who does want a reproducible
  build to take each version from that package's own npm page — never one version
  across both links, since a version a package never published is a hard 404 and
  a 404'd stylesheet also renders unstyled with no error.

  Gated by `tests/guards/doc-cdn-urls.test.mjs` (offline; runs under
  `pnpm test:guards` in the required `Starter` job), which fails on any versioned
  `@civitai/*` jsDelivr URL in those four shipped docs. Verified as a regression
  test rather than an invariant guard: **red at `72d555a` naming all 7 literals,
  green at HEAD.** `CHANGELOG.md`s are deliberately out of scope — they quote
  pinned URLs as history, and nobody copy-pastes from a changelog.

  Docs-only, but it needs a release: all four files are in their package's `files`
  array, so the corrected copy only reaches npm — and the docs generated from it —
  on a publish.

- Updated dependencies [ee25ac9]
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
  - @civitai/theme@0.3.0

## 0.3.1

### Patch Changes

- 77ce989: Refresh the stale CDN version pins in the shipped docs (`MARKUP.md`, both
  `README.md`s, `demo/index.html`) to the currently-published versions —
  `@civitai/theme@0.2.0` and `@civitai/components@0.3.0`.

  Both links were still pinned at `@0.1.1` (published 2026-07-22), two minors
  behind `components@0.3.0` (2026-07-29) and one behind `theme@0.2.0`
  (2026-07-23). That URL still resolves — jsDelivr serves every published version
  forever — so this never surfaced as a broken link. It silently served an old
  stylesheet: `components@0.1.1/styles.css` is 8,713 B and carries rules for **10**
  distinct `data-civitai-ui` values; `@0.3.0` is 28,042 B and carries **20**.

  `MARKUP.md` documents 19 component sections. So an external HTML author
  following the markup contract verbatim wrote correct, contract-shaped markup for
  `checkbox`, `image`, `radio`, `radio-group`, `segmented-control`, `select`,
  `slider`, `toast`, `toast-region` and `tooltip` against CSS that has no rules for
  any of them — they render as unstyled bare elements, with no console error and no
  failed request to notice. The theme pin was stale the same way: 17 `--civitai-*`
  tokens at `0.1.1` vs 27 at `0.2.0`, so every token added since resolved to
  nothing.

  **These packages version INDEPENDENTLY — there is no shared version number.**
  `@civitai/theme` has never published a `0.3.0`. Applying one version across both
  links (the obvious-looking "bump them all to 0.3.0" fix) produces
  `…/@civitai/theme@0.3.0/styles.css`, which is a hard 404 — and a stylesheet that
  404s renders an unstyled page with no error either, so the wrong fix fails the
  same silent way as the stale pin it replaces. `demo/index.html`'s comment now
  says so at the point of copy-paste.

  Every URL written here was verified to return 200 before commit, with the check
  first validated against known-bad inputs (`theme@0.3.0` and `components@0.9.9`
  both correctly reported 404).

  Docs-only, but it needs a release: `MARKUP.md`, `README.md` and `demo/` are all
  in `@civitai/components`'s `files`, and `README.md` is in `@civitai/theme`'s, so
  the corrected copy only reaches npm — and the docs generated from it — on a
  publish.

- Updated dependencies [77ce989]
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

## 0.2.0

### Minor Changes

- b896dd9: Design-system minor release (0.2.0, lockstep) — resolves the three deferred DX items from #181.

  **F5 — default light-mode Card hairline (VISIBLE CHANGE).** In light mode `--civitai-color-surface` equals `--civitai-color-body`, so a borderless `Card` was invisible against the page. Cards now render a subtle default hairline (a low-alpha mix of the border token) so a Card _without_ `data-with-border` is still visible. `data-with-border="true"` remains the stronger, fully-opaque explicit border. Dark mode already differentiates surface from body and is visually unchanged. **Consumer impact:** any previously-borderless light-mode Card now shows a faint edge — intended, but review if you relied on an edgeless card.

  **F6 — new `checkbox` / `radio` / `select` components (new permanent public API).** `@civitai/components` gains `data-civitai-ui="select"` (native `<select>` on the shared `-control` field chrome), `data-civitai-ui="checkbox"` / `"radio"` (themed native inputs — `accent-color` tint + custom sizing/focus-ring/disabled, box+label in a `-choice` row), and `data-civitai-ui="radio-group"` (`role=radiogroup` layout). `@civitai/components-react` adds the matching `Select` / `Checkbox` / `Radio` / `RadioGroup` `forwardRef` bindings. See `MARKUP.md` for the full markup + ARIA contract.

  **F7 — richer neutral token ramp.** `@civitai/theme` now exposes the full 10-step Mantine gray ramp as `--civitai-color-gray-0` … `--civitai-color-gray-9` (`colorGray0`…`colorGray9` in the typed export), generated through the token pipeline from the drift-guarded `gray` tuple. Additive — the existing semantic neutrals are unchanged.

### Patch Changes

- Updated dependencies [b896dd9]
  - @civitai/theme@0.2.0

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
