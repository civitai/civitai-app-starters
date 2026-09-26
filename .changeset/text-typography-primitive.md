---
'@civitai/components': minor
'@civitai/components-react': minor
---

Add `Text` — the typography primitive — on both tracks:
`data-civitai-ui="text"` and `<civitai-text>`, plus the `<Text>` React binding.

**Why.** The pack had no text, heading or paragraph component on either track —
the only text-named elements were the two form controls, `civitai-text-input`
and `civitai-textarea`. A consumer composing a page out of this pack could not
put a headline, a paragraph or a section title on it, so every composed page
read as a pile of self-labelling widgets. That is a hole in the design system
rather than in any one consumer. (Typography *utilities* were never the hole:
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
  `--civitai-color-text` itself: a *specified* value beats an *inherited* one at
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
every other component in this sheet states its metrics. What it does *not* do is
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
`@civitai/blocks-react`'s `injectBlocksStyles()` — reached on mount by 20 of that
package's 21 `/ui` components (`SettingsForm` is deliberately unstyled) — adds
that package's interactive CSS on top and still no utilities. So an App Block
author who hand-writes `<p data-civitai-ui="text">`, which rendering a `/ui`
component is documented to style, gets the new inherit behaviour together with a
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
