---
"@civitai/theme": minor
---

feat(theme)!: dark is the base, and the stylesheet no longer consults the OS

**BREAKING for CSS consumers that relied on the old default.** `:root` now
carries the **dark** palette and `color-scheme: dark`, and the
`@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` block is
**gone** — with no OS-light block replacing it. An element with no `data-theme`
above it is now dark on every machine, where before it followed the viewer's OS
preference.

**Why.** The old shape put the design system and the surfaces built on it in
direct disagreement: `@civitai/theme` was light-base-plus-OS-dark, while
civitai.com is dark and an App Block boots dark and takes light only from its
host (`@civitai/blocks-react` 0.62.1). The consequence was not theoretical — it
is why every surface spanning the two had to set `data-theme` **explicitly** just
to stop the browser deciding, and why a component that merely *inherited* the
default silently handed itself back to the OS. That workaround is what this
removes: dark-by-default is now a property of the stylesheet rather than
something each consumer re-asserts.

**What did not change.** `[data-theme='light']` is still a full mirror of the
light palette and still the way to get light; `[data-theme='dark']` still
restores dark inside a light subtree; the attribute still wins wherever it sits.
The JS exports are untouched — `tokens` remains the LIGHT map and `darkTokens`
the dark one, so `tokens` no longer describes `:root`. That naming is kept
deliberately: this release breaks the CSS default and nothing else, which keeps
it reviewable and revertable in one piece. The `@property` initial-values do move
to dark, for consistency with `:root` — not as an independently observable
behaviour; see the note at the emission site.

**If you need the old behaviour**, set `data-theme` from your own
`matchMedia('(prefers-color-scheme: dark)')` listener. Nothing in the stylesheet
will do it for you, and that is the point.

**Upgrading.** Most consumers need no change: anything already setting
`data-theme` is unaffected, which includes every `@civitai/components` element
mounted under an explicit theme. What moves is the **unthemed** case. If you
relied on it being light, add `data-theme="light"` where you render.

Verified rather than asserted — the discriminating fixture is a **light** OS,
because a dark-OS context answers "dark" under both the old and new designs and
proves nothing:

- `@civitai/components` `test/color-scheme.dark-base.browser.test.ts` (new): real
  Chromium reporting `prefers-color-scheme: light`, with that report asserted
  first as the fixture's own control. 6 cases; **3 are red against the previous
  release** (dark-by-default, the light palette not applying, and a shadow-root
  hairline that was 1px before).
- `@civitai/theme` `test/generation-parity.test.ts` (extended): the sheet
  declares no `prefers-color-scheme` in either direction, `:root` carries the
  dark value for every token that has one, and the light block is a full mirror.
  **Red against the previous generator**, except the mirror assertion, which is
  labelled in-file as an invariant guard rather than counted as regression
  coverage.
- `test/color-scheme.prefers-dark.test.ts` keeps passing and its docstring now
  says why that is **not** evidence for this change.
