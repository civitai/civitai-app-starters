---
'@civitai/components': minor
'@civitai/components-react': minor
---

Add `Text` — the typography primitive — on both tracks:
`data-civitai-ui="text"` and `<civitai-text>`, plus the `<Text>` React binding.

**Why.** The pack shipped 46 custom elements and 323 utility classes and had no
text, heading or paragraph component on either track — the only text-named
elements were the two form controls, `civitai-text-input` and `civitai-textarea`.
A consumer composing a page out of this pack could not put a headline, a
paragraph or a section title on it, so every composed page read as a pile of
self-labelling widgets. That is a hole in the design system rather than in any
one consumer.

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
- `data-size`: `xs` · `sm` · `md` (default) · `lg` · `xl` — 12/13/14/16/20px.
  `sm`/`md`/`lg` are byte-identical to Button's own font-size ramp, so one size
  name means one size across the pack; `xs` is the 12px the field description
  already uses; `xl` is the single new step, and the only one that tightens its
  line-height.
- `data-weight`: `normal` (default) · `medium` · `semibold` · `bold` — the
  weights `utilities.css` already spells, plus the 500 this sheet already uses.
- `data-color`: `dimmed` · `info` · `success` · `warning` · `error`. The intent
  four are the same enum Alert, Badge and Toast share; `dimmed` is the one
  addition, and most of the reason the attribute exists.
- **Margins are reset to `0`.** The UA's heading/paragraph margins are
  em-relative, so they would move with every `data-size`; vertical rhythm here
  belongs to `stack`/`group`. It is also what makes the two tracks lay out
  identically.

**Tokens: nothing new.** `@civitai/theme` exposes `--civitai-font` and
`--civitai-font-mono` and no size, weight or leading scale — Mantine expresses
those per component — so this consumes the existing colour tokens
(`--civitai-color-text`, `-text-dimmed`, and the four intents) and states its
px scale in `MARKUP.md` as a table, the way every other component in this sheet
states its metrics.

**Deliberately NOT in v1**, because the API is hard to change later and both
already exist one layer down: **alignment** is `ci-text-start` /
`ci-text-center` / `ci-text-end` (and `text-align` inherits, so it reaches
`<civitai-text>` too) and **truncation** is `ci-truncate`. A `data-align` or
`data-truncate` here would be a second copy of a predicate that already has an
implementation. Adding either later is additive; removing one would not be.

Additive: no existing component, attribute, token or export changes behaviour.
