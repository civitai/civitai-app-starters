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
  This ships `minor` on two published packages, so adding the axis later stays
  additive while taking it away would not be.
- **Margins are reset to `0`.** The UA's heading/paragraph margins are
  em-relative, so they would move with every `data-size`; vertical rhythm here
  belongs to `stack`/`group`. It is also what makes the two tracks lay out
  identically.

**Tokens: nothing new.** `@civitai/theme` exposes `--civitai-font` and
`--civitai-font-mono` and no size, weight or leading scale — Mantine expresses
those per component — so this consumes the existing colour tokens
(`--civitai-color-text` and, via the utilities, `-text-dimmed` and the intents)
and states its px scale in `MARKUP.md` as a table, the way every other component
in this sheet states its metrics.

**Deliberately NOT in v1** — each already has an implementation one layer down,
and one predicate decides all three: **colour** → `ci-muted` / `ci-text-*`,
**alignment** → `ci-text-start` / `ci-text-center` / `ci-text-end`,
**truncation** → `ci-truncate`. `color` and `text-align` inherit, so the first
two reach `<civitai-text>` as well; `overflow` does not, so truncation on the
element track is a real follow-up rather than an oversight. Adding any of them
later is additive; removing one would not be.

⚠️ **Colouring Text requires `utilities.css`, which is a separate stylesheet.**
It is not bundled into `styles.css` and `injectStyles()` does not inject it, so
load `@civitai/components/utilities.css` alongside `styles.css` if you colour,
align or truncate text. `demo/index.html` now links all three.

**Both tracks — a choice, not a rule.** Most elements in this package have no
attribute-track twin, so "every other component ships both" would be false; the
relationship that holds is the converse (nearly every attribute slug also has an
element). Text ships both to stay on the side of that pattern and of a published
consumption mode.

Additive: no existing component, attribute, token or export changes behaviour.
