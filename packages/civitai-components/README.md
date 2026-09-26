# @civitai/components

Attribute-driven, **framework-agnostic** component CSS for civitai App Blocks.
Plain HTML (or any framework) gets civitai-themed components with no build step —
style is selected entirely by `data-civitai-ui="…"` + `data-variant` /
`data-size` attributes, themed by [`@civitai/theme`](../civitai-theme)'s
`--civitai-*` tokens.

For the component list — and each one's required markup, attributes and ARIA
wiring — see [`MARKUP.md`](./MARKUP.md), which ships in this package and is the
source of truth. It is deliberately not duplicated here: this sentence used to
carry a hand-written list, and it silently fell ten components behind.

## Consume

**Zero JS** — link both stylesheets and author plain HTML per
[`MARKUP.md`](./MARKUP.md):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components/styles.css" />

<button data-civitai-ui="button" data-variant="filled" data-size="md">Generate</button>
```

Unversioned on purpose — see the note in [`MARKUP.md`](./MARKUP.md#setup). A
pinned CDN URL keeps returning 200 with an old stylesheet, so newly documented
attributes silently render unstyled.

**From JS** — `injectStyles()` injects both the tokens and the component CSS,
idempotently:

```ts
import { injectStyles } from '@civitai/components';
injectStyles();
```

React authors want [`@civitai/components-react`](../civitai-components-react),
which renders exactly this markup.

### One component's CSS only — not available, on purpose

`componentsCss` / `injectStyles()` / `styles.css` all carry the **whole** sheet.
There is **no supported way to import one component's rules**, and no
`@civitai/components/css/*` subpath: the package declares exactly two exports,
`.` and `./styles.css`.

The build does slice the sheet — `scripts/build-css.ts` writes one standalone,
layered stylesheet per section to `dist/css/<slug>.css` — but nothing in
`exports` names them **and they are excluded from the published tarball**
(`files` carries `"!dist/css"`). They are build inputs for this repo's own
measurement, not an API, and they are not in your `node_modules`. Treat them as
private and unstable; they can be renamed or removed in a patch release.

Why hold a surface whose files are already built: files on disk are reversible,
an `exports` key on a published package is not, and no consumer imports them
today. Opening the surface is cheap later and irreversible now. Not exporting
them was never a reason to *ship* them, either — under an earlier `files:
["dist"]` they added 70 unnameable files to every install.

> 🔴 **`@civitai/blocks-react` deliberately injects the whole pack.**
> [`MARKUP.md`](./MARKUP.md) documents that rendering any one `/ui` component is
> enough to style hand-written `data-civitai-ui="…"` markup elsewhere on the
> page; narrowing it onto slices would take the bytes and break that contract
> silently. Whether to do it anyway — and what, if anything, to export — is
> [issue #358](https://github.com/civitai/civitai-app-starters/issues/358),
> which `pnpm measure:css-split` prices.

## Elements

The same components as **custom elements**, so behaviour ships with the style
instead of being reimplemented per framework. They render in a shadow root and
read the same `--civitai-*` tokens, which inherit across the boundary.

```ts
import '@civitai/components/register';               // every element
import '@civitai/components/civitai-button/define';  // just this one
```

```html
<civitai-button variant="filled" size="md">Generate</civitai-button>
<civitai-text-input label="Prompt" name="prompt"></civitai-text-input>
<civitai-segmented-control aria-label="View"></civitai-segmented-control>
```

One script tag, no build:

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@civitai/components/elements.js"></script>
```

`elements.js` is a self-contained bundle at the package root, because jsDelivr
ignores `exports` — the same reason `styles.css` is copied there. The build
fails if it exceeds **25 kB gzip**; it currently sits at about 19 kB.

### The civitai vocabulary

`site-elements.js` is the same kit **plus** the elements that only mean
something on civitai.com — `<civitai-avatar>`, `<civitai-rating-badge>`,
`<civitai-tag>`. Load one bundle or the other, never both: they each carry their
own copy of Lit, and a superset costs less over the wire than two that overlap.

`<civitai-menu>` is *not* in there — a dropdown is generic, so it ships in
`elements.js` with the modal and the tabs.

```html
<script type="module"
  src="https://cdn.jsdelivr.net/npm/@civitai/components/site-elements.js"></script>
```

```ts
import '@civitai/components/register-site';       // generic kit + vocabulary
import '@civitai/components/civitai-tag/define';  // just this one
```

These are presentational: state goes in as attributes, intent comes out as an
event. `<civitai-tag>` emits `vote` with `{ name, vote }` and clears the vote
when you press the side you already chose, exactly as the site's own control
does — where that vote *goes* is a binding's problem, not the element's. The
rating ladder (`g`/`pg`/`pg13`/`r`/`x`) is the site's own off-site vocabulary,
and an unrecognised value renders verbatim rather than being reshaped.

`confidence` (0–1, from the tagger) draws the bar behind the label. It is
separate from `score`, which is the vote total — the site's own pill happens to
derive its bar from the score, but the two are different numbers.

### The image card

`<civitai-media-card>` is the media plus three overlay slots — `top-start`,
`top-end` and `bottom` — with a scrim behind the last so counts stay readable on
a pale image. Give it an `href` and the media becomes a link; the overlays stay
siblings of that link, so a menu or a button in a corner is still reachable.

```html
<civitai-media-card href="/images/1" label="Open image">
  <img slot="media" src="…" alt="" />
  <civitai-rating-badge slot="top-start" rating="pg"></civitai-rating-badge>
  <civitai-menu slot="top-end" label="Image actions">…</civitai-menu>
  <civitai-action-button slot="top-end" label="Remix">
    <span slot="icon" aria-hidden="true">✦</span>
    <span slot="icon-expanded" aria-hidden="true">→</span>
  </civitai-action-button>
  <civitai-reaction slot="bottom" emoji="👍" label="Like" count="13100"></civitai-reaction>
</civitai-media-card>
```

`<civitai-action-button>` is a circle that expands to its label on hover or
focus; `expanded` holds it open, which is the whole of touch support. Give it an
`icon-expanded` and the icon crossfades into an inverted chip as the pill opens;
give it only `icon` and nothing swaps. On a media card it turns light regardless
of the page theme, because its background is the image.

The `top-end` corner stacks — the kebab sits at the top and the action button
hangs under it — while `top-start` and `bottom` stay in a row, which is where
the rating and the `POI` badges sit side by side. `<civitai-reaction>`
abbreviates its count the way the site does.

### Image, video and audio

`<civitai-image>`, `<civitai-video>` and `<civitai-audio>` follow HTML's three
media elements, and share the states a generated file goes through: `pending`
while it is still being made (a loader, and nothing requested), `blocked` when
it is withheld from this viewer (the `blocked` slot says why, and the file is
never requested), and the `fallback` when it fails to load, which is how an
expired signed URL shows up. Listen for `error` to hand it a fresh `src`.
`status` reflects `loading`, `loaded`, `error` or `blocked`.

```html
<civitai-image openable src="…" alt="A red bike" style="width: 160px; aspect-ratio: 1"></civitai-image>
<civitai-video preview openable src="…" alt="A paper boat" style="width: 160px; aspect-ratio: 1"></civitai-video>
<civitai-audio src="…" alt="A jingle">
  <span slot="blocked">Hidden: mature content</span>
</civitai-audio>
```

`openable` makes an image, or a `preview` video, a button that emits `open`, so a
viewer opens from the keyboard too. A `preview` video is muted, loops and plays
only while hovered or focused; a full video keeps its native controls, and so
cannot be a button. Size them from outside; `--civitai-media-max-height` caps a
tall one without cropping when `fit="contain"`.

[`custom-elements.json`](./custom-elements.json) is the published contract —
every tag, attribute, property, `::part` and slot. It is generated from the
element sources (tags from `defineElement(TAG, …)`, parts and slots from the
templates), so nothing is restated in JSDoc and nothing can drift. A test fails
if it stops matching what the package registers.

The attribute CSS above keeps shipping unchanged at the same path, so nothing
has to migrate. The `.` entry still carries no renderer — importing
`injectStyles()` does not pull Lit in, and a test asserts it.

Elements set their own tokens up: the first one to connect calls
`injectTokens()` on its document, so a single `<script type="module">` is
enough on a bare page.

| | |
|---|---|
| Attributes | mirror the props, kebab-cased (`full-width`) |
| Properties | `el.variant = 'outline'` — identical result to the attribute |
| Styling hooks | `::part(button)`, plus every `--civitai-*` token |
| Forms | form-associated: `FormData`, `form.reset()`, `type="submit"`/`type="reset"` and Enter-to-submit all work, which controls inside a shadow root otherwise lose |
| Events | `change` is re-dispatched across the boundary (it is `composed: false`, so it would never escape) |

`<civitai-segmented-control>` and `<civitai-select>` take their items as a
property, since an attribute cannot carry structured data:

```ts
document.querySelector('civitai-segmented-control').data = [
  { value: 'grid', label: 'Grid' },
  { value: 'list', label: 'List' },
];
```

It implements the roving tabindex `MARKUP.md` currently asks hand-HTML authors
to write themselves: one tab stop, arrows wrapping across enabled segments,
Home/End, and selection following focus.

`error` on a field also makes it **invalid**, so the form will not submit while
the message shows — unlike the React binding, which draws the message but leaves
`checkValidity()` true despite setting `aria-invalid`.

### Working on them

```bash
pnpm --filter @civitai/components dev           # playground, HMR from src/
pnpm --filter @civitai/components test:browser  # element behaviour + parity
```

The playground imports the elements from `src/`, so an edit is on screen
without a build. `demo/` is the opposite: it loads the published artifact from
jsDelivr to verify what consumers actually get.

### The dashboard five

Added because a real consumer needed them and the vocabulary had no answer:

| | |
|---|---|
| `<civitai-switch>` | The checkbox wearing a track and a thumb. It *extends* `<civitai-checkbox>` rather than restating it, so the form participation, validity and `role="switch"` all come from one implementation. |
| `<civitai-progress>` | Determinate or `indeterminate`, with the ARIA value dropped in the second case because the element genuinely does not know it. |
| `<civitai-pagination>` | Keeps the first and last page either side of an ellipsis, so the buttons do not move under the pointer as you page. Emits `change`. |
| `<civitai-breadcrumb>` | `data`-driven. The separator is a pseudo-element, which is what keeps it out of the trail a screen reader reads. |
| `<civitai-table>` | **Light DOM on purpose**: a slotted `<tr>` inside a shadow `<table>` leaves the table formatting context and stops being a row. This styles a table the page already owns — including one a data grid generated, which is why it works with QuickGrid or any server-rendered table. |

### Navigation

Primitives, not an app shell — the reusable part of a sidebar is the nav tree's
behaviour, not the chrome around it. Lay the page out with the utilities.

```html
<civitai-nav-list label="Sections" current="/jobs/replay">
  <civitai-nav-item href="/" label="Summary"></civitai-nav-item>
  <civitai-nav-item label="Jobs">
    <civitai-nav-item href="/jobs" label="Active"></civitai-nav-item>
    <civitai-nav-item href="/jobs/replay" label="Replay"></civitai-nav-item>
  </civitai-nav-item>
</civitai-nav-list>
```

`current` is an `href`, matched exactly. The list marks that item and **opens
every group above it**, which is the part sidebars usually get wrong: landing
on a nested route with the section containing it still collapsed. An item is a
link when it has an `href` and a disclosure when it has children — an `href`
with children is still a disclosure, never an anchor that also toggles. Depth
is counted by the item, so nesting indents without anyone tracking levels.

Icons stay slotted (`<slot name="icon">`): the package ships no icon set, so
an app brings its own and pays for nothing it does not use.

### Grouping, and a confirmation

| | |
|---|---|
| `<civitai-button-group>` · `<civitai-input-group>` | **Light DOM**, because joining controls means reaching their `::part(button)` / `::part(control)`, and a part crosses exactly one boundary — reachable from the document, never from a shadow root the controls were slotted into. |
| `<civitai-confirm-dialog>` | Extends `<civitai-modal>`, so the focus trap and the top layer come from one implementation. `await dialog.ask()` resolves `true`, `false` on cancel, and `false` on a dismissal — a caller is never left waiting. Destructive confirmations land focus on Cancel. |

### Acting as the viewer

`<civitai-sign-in-button>` does something rather than showing something: it
signs the viewer in, through [`@civitai/sdk`](../civitai-sdk). That makes the
SDK an **optional peer dependency** — install it only if you use an element
like this one.

```ts
import '@civitai/components/civitai-sign-in-button/define';
```

Inside a civitai.com page it asks the host, and `return-url` is where the
viewer lands afterwards:

```html
<civitai-sign-in-button return-url="/gallery">Sign in to continue</civitai-sign-in-button>
```

An app of its own hands it `createSignIn()`'s result instead, and the same
button leaves for Civitai itself:

```ts
const auth = await createSignIn({ clientId, scopes: ['user:read:self'] });
document.querySelector('civitai-sign-in-button').signIn = auth;
```

Either way it disappears once the viewer is signed in.

These elements are not in `register`, `register-site`, `elements.js` or
`site-elements.js`, so a page that wants only the look never bundles the SDK;
`test/entry-points.test.ts` fails if one of them becomes reachable from there.
`<civitai-workflow-button>` is the other one: give it a workflow and it prices
it, runs it on the viewer's Buzz, and says where the workflow is while it runs.

```ts
import type { CivitaiWorkflowButton } from '@civitai/components/civitai-workflow-button';
import '@civitai/components/civitai-workflow-button/define';

const button = document.querySelector<CivitaiWorkflowButton>('civitai-workflow-button')!;
button.app = app;                   // from initialize(); a block may omit it
button.template = { steps: [{ $type: 'imageGen', input }] };
button.addEventListener('finished', (event) => show((event as CustomEvent).detail.workflow));
```

```html
<civitai-workflow-button label="Bake"></civitai-workflow-button>
```

It is one control, not three. The label carries the price
(`Bake for 185 Buzz`) as soon as the estimate lands, so no one spends without
seeing it. While the workflow runs, the button spins, says what stage it is at,
and fills its own background with the workflow's own estimate — the lowest rate
any step reports, since that is what the workflow is waiting on, whether its
steps run in turn or together. A workflow of several steps also counts them off
(`working… 1/2`) as each one finishes. Pressing it again asks whether to
cancel, warning that work already under way may finish anyway and offering the
workflow id to copy, since that is what support asks for; if the run ends while
that question is on screen, the question goes away with it. When the run
ends the button says so — `Done!`, `Failed`, `Canceled` — for a moment before
offering its price again. It emits `priced`, `submitted`,
`progress`, `finished`, `canceled` and `error`, and asks for
`ai:write:budgeted` first — set `scopes=""` to leave consent to the app.
`variant`, `size`, `full-width` and `disabled` pass through to the button it
wraps, so it behaves like one.

Waiting for the host applies only to the host path: with no validated host
origin a press sends nothing and the button renders disabled. Given a `signIn`
it is usable at once, since no handshake is involved.

## Utilities

Elements cover the components. They cannot cover the markup *between* them —
the row, the gap, the margin — and until now this package had no answer for
that, so every hand-HTML author wrote their own. `./utilities.css` is that
answer: ~217 classes under a `ci-` prefix, spending the same tokens the
elements do.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components/utilities.css" />

<div class="ci-flex ci-items-center ci-justify-between ci-gap-2 ci-mb-4">
  <civitai-badge>New</civitai-badge>
  <span class="ci-muted ci-small">3 minutes ago</span>
</div>
```

Spacing is a scale of its own — `--civitai-space-0` through `-6` — because
Mantine expresses spacing per component rather than as a ramp, so
`@civitai/theme` has nothing to derive it from. Override the custom properties
to retune every utility at once. Colour utilities name tokens rather than
shades, so `ci-muted` follows the theme into dark mode instead of pinning a
grey. The grid is CSS Grid: `ci-row` is twelve columns, `ci-col-4` spans four,
and `ci-md-col-6` does it from the `md` breakpoint up.

### Coming from Bootstrap

`./bootstrap-compat.css` is a **transitional** sheet that maps Bootstrap's own
class names onto the same declarations, so a page can adopt the tokens before
it touches its markup. It keeps Bootstrap's breakpoints rather than ours,
because its job is to preserve behaviour while the markup moves.

```html
<link rel="stylesheet" href="…/@civitai/components/bootstrap-compat.css" />
<!-- `d-flex`, `mb-3`, `col-md-6`, `text-muted` keep working, on civitai tokens -->
```

It is meant to be deleted. A browser test asserts every alias computes
identically to the `ci-` utility behind it, so a rule can be dropped the day its
markup moves and nothing else shifts.

### Authoring rules

Four decisions that were implicit until an API review made them explicit. They
describe the set as it stands; a new element that breaks one needs a reason.

**Content: a property when the element reads it, a slot when it does not.** A
property is right where the element must measure, truncate or transform the
text — `<civitai-tag name>` is uppercased and sized against the confidence bar,
`<civitai-action-button label>` is animated to its own content width,
`<civitai-avatar name>` is reduced to initials. Everything a consumer might want
to style or enrich takes a slot, which is why `<civitai-badge>`, `<civitai-alert>`
and `<civitai-menu-item>` take theirs that way. Mixing them is how
`<civitai-tag>`'s label once vanished behind a slotted menu.

**Parts are named after the property that fills them**, not after the tag that
renders them: `heading` for the box `heading` fills, `label` for `label`. Where
no property fills it, the part is the element's role — `button`, `control`,
`panel`, `body`.

**No `exportparts`, because nothing needs it.** Every composition in this set is
by slot, and a slotted child lives in the consumer's own light DOM, so
`civitai-reaction::part(button)` already reaches it. `exportparts` would only be
needed if an element rendered another civitai element inside its own shadow
root — none does, and one that did should ask first whether a slot is the
better shape.

**Visibility is a property; the methods are sugar.** An element with an `open`
property also answers `show()`, `hide()` and `toggle()`, so neither style
surprises anyone. A region that manages a collection rather than one box gets
its own verbs instead — `<civitai-toast-region>` has `show(options)`,
`dismiss(id)` and `clear()`, because it is a queue.

## Design

- All rules live in `@layer civitai.components`, so consumer CSS wins the
  cascade without specificity fights.
- State colors (hover/active/tint) are derived with `color-mix()` from base
  tokens — no shade enumeration.
- Authored in plain CSS with native nesting (no preprocessor); `src/components.css`
  is the single source of truth (copied to `dist/components.css`, embedded as
  the injectable string, and sliced per component — all three guarded by parity
  tests; the slicing additionally by the boundary guard, which
  is what pins where the sheet was cut. The byte-identical-reassembly assertion
  also runs before anything is written, but it proves the partition arithmetic
  only, not the cut points).

## Markup contract

Styling is selected entirely by `data-*` attributes; any HTML that follows the
contract below renders identically to the React bindings. **`legend`:** _bold_ =
required for correct styling + a11y. [`MARKUP.md`](./MARKUP.md) is the canonical
source (with per-component examples + a11y wiring) and the executable contract
the `html-vs-react-parity` browser test enforces; the essentials are inlined
here so they're readable on the npm package page.

**Theming** — set `data-theme="light"` or `data-theme="dark"` on any ancestor
(typically `<html>` or the block root); tokens re-resolve from that scope
(default = light). **Cascade** — every rule lives in `@layer civitai.components`,
so your own unlayered CSS always wins with no `!important`; override a token
locally by redeclaring it (`style="--civitai-color-primary: #a259ff"`).

### Button — `data-civitai-ui="button"`
- Element: **`<button>`** (or `<a role="button">`).
- `data-variant`: `filled` (default) · `light` · `outline` · `subtle`
- `data-size`: `sm` · `md` (default) · `lg` · `data-full-width="true"`.
- Loading: **`aria-busy="true"` + `disabled`**, first child
  `<span data-civitai-ui="loader" data-size="sm" aria-hidden="true"></span>`.
- Icon slots: `<span data-civitai-ui-section="left|right">`. Icon-only ⇒ `aria-label`.

### TextInput — `data-civitai-ui="text-input"`
Wrapper **`<div data-civitai-ui="text-input">`** containing, in order:
**`<label data-civitai-ui-label for="ID">`** (+ optional
`<span data-civitai-ui-required aria-hidden="true">*</span>`), optional
`<span id="ID-desc" data-civitai-ui-description>`, **`<input data-civitai-ui-control id="ID">`**,
optional `<span id="ID-err" data-civitai-ui-error role="alert">`. When invalid:
`aria-invalid="true"` on the control + `data-invalid="true"` on the wrapper, and
`aria-describedby="ID-desc ID-err"`.

- **Textarea** — `data-civitai-ui="textarea"`; control is **`<textarea data-civitai-ui-control>`**.
- **NumberInput** — `data-civitai-ui="number-input"`; control is **`<input type="number" data-civitai-ui-control>`**.

### Card — `data-civitai-ui="card"`
`data-with-border="true"` · `data-padding`: `sm` · `md` · `lg`. Presentational
container (`<div>`/`<section>`/`<article>`).

### Stack / Group — `data-civitai-ui="stack" | "group"`
Vertical (Stack) / horizontal center-aligned (Group) flex. `data-gap`: `sm` · `md` · `lg`.

### Alert — `data-civitai-ui="alert"`
**`role="alert"`** (or `role="status"`). `data-color`: `info` (default) ·
`success` · `warning` · `error`. Structure: optional icon, then
**`<div data-civitai-ui-alert-body>`** with optional
`<div data-civitai-ui-alert-title>` + the message; optional
`<button data-civitai-ui-alert-close aria-label="Dismiss">×</button>`.

### Loader — `data-civitai-ui="loader"`
`data-size`: `sm` · `md` (default) · `lg`. Decorative inside a button ⇒
`aria-hidden="true"`; standalone ⇒ `role="status"` + accessible label.

### Badge — `data-civitai-ui="badge"`
`data-variant`: `filled` (default) · `light` · `outline`. `data-size`: `sm` ·
`md` (default) · `lg`. `data-color` (optional): `info` · `success` · `warning` ·
`error` (mirrors Alert; omit for the default primary accent). Presentational
`<span>`; add `aria-label` if it conveys status.

## Demo

`demo/index.html` (shipped in the package) is a **complete, copy-paste
plain-HTML page** — the two CDN `<link>` tags, one of every component, a
light/dark `data-theme` toggle, and page theming via `var(--civitai-color-body)`.
Open it directly in a browser (it loads the CSS from jsDelivr, zero build step),
or copy it as the starting point for a no-framework block.
