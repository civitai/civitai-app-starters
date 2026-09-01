---
'@civitai/components': minor
'@civitai/blocks-react': minor
---

Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

**`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

This is not a new opinion; it makes the CSS agree with a default that was already shipping. React `<Group>` defaults `wrap = true` and writes `flex-wrap` as an *inline* style, so React consumers have always wrapped. Bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve, and what every non-React consumer gets — carried no `flex-wrap` at all. Same component, two surfaces, opposite defaults, and nothing could see it because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 321px box**. They now reflow onto two rows and fit. A test pins the two defaults together so they cannot drift apart again.

`min-width: 0` is what lets a long unbroken label ellipsize instead of pushing the row wide; it is set at zero specificity (`:where()`) so a child's own rule still wins.

**`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

---

**Reviewer note on the bump level.** Both are marked `minor`. `data-nowrap` is additive, and the `group` change is arguably a *fix* to a documented default rather than a new behaviour. But by the strict reading of `RELEASING.md`'s table it is "a behavior change that existing callers will notice", i.e. `major` — and on a pre-1.0 package that would publish `@civitai/components@1.0.0`. Flip this to `major` before release if that is the intent; it was not obviously mine to decide.
