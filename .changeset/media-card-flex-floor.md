---
"@civitai/components": minor
---

fix(media-card): a tile in a row rendered at 0x0, so a gallery was invisible

`<civitai-media-card>` is a pure aspect-ratio box with no intrinsic content width,
and its `overflow: hidden` already gives it an automatic minimum size of 0
(CSS Flexbox §4.5). As a flex item in a **row** that resolved to zero width, and the
aspect ratio took the height down with it — so three tiles inside a
`<civitai-group>` rendered as three 0x0 boxes. Not "looks broken": **invisible**,
while every structural check still passed.

A tile could not fix this from its own `:host` rule. For a **slotted** element the
outer tree's declaration beats the inner tree's regardless of specificity, and
`<civitai-group>`'s `::slotted(*) { min-width: 0 }` — which exists so a long label
can shrink below its content width — always won.

So the zeroing became opt-out-able rather than flat:

- `<civitai-group>` now reads `--civitai-group-item-min-width`, **defaulting to `0`**.
  For every child that does not set it the behaviour is byte-for-byte what it was.
- `<civitai-media-card>` sets that property, and its own `min-width`, to
  `min(var(--civitai-media-card-min-width, 12rem), 100%)`.

**Minor rather than patch** because both custom properties are new public contract.

⚠️ **Behaviour change worth knowing about:** a media-card now has a 12rem inline floor.
A consumer that deliberately rendered a tile narrower than that in a flex row was
previously getting a zero-width element, but one sized explicitly below 12rem will now
be held at the floor — set `--civitai-media-card-min-width: 0` on it to opt out.

The floor is inline-axis **on purpose**. `flex-basis` is the tempting knob and is
wrong: `<civitai-stack>` is `flex-direction: column`, where a basis sets the main size
and would therefore change every stacked card's **height**. `min-width` cannot reach
the block axis. `min()` against `100%` is what keeps block layout safe — in a slot
narrower than the floor the percentage wins, so a card still shrinks to fit instead of
overflowing.

All three properties are pinned by new cases in `civitai-media-card.browser.test.ts`
(the row survives; a column stack's height still comes from the aspect ratio; a narrow
container does not overflow). Those cases supply **no explicit width** — every other
fixture in that file pins `style="width: 240px"`, which is why the suite was
structurally blind to this.
