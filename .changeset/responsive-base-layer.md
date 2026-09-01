---
'@civitai/components': minor
'@civitai/components-react': minor
'@civitai/blocks-react': minor
---

Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

**`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

There are **three** `group` surfaces, and they did not agree:

- `@civitai/blocks-react`'s `<Group>` defaults `wrap = true` and writes `flex-wrap` as an *inline* style — its consumers have always wrapped;
- `@civitai/components-react`'s `<Group>` writes no inline style at all and has no `wrap` prop, so it resolved against the CSS;
- bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve — likewise.

The CSS carried no `flex-wrap`, so the latter two did not wrap. Nothing could see it, because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 321px box**. They now reflow onto two rows and fit, and a test pins the CSS default against the rendered React default so they cannot drift apart again.

**Be precise about what this is:** for `blocks-react` it aligns the CSS to a default that was already shipping, but for `@civitai/components-react` and for bare markup it is a genuinely **new default**.

`min-width: 0` lets one long unbroken label narrow instead of pushing the whole row past its container. It applies to a child with the default `overflow: visible`; per CSS Flexbox §4.5 a child with any other `overflow` already has an automatic minimum size of 0.

**`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

---

**Reviewer note on the bump level — an adversarial audit recommends `major` for `@civitai/components`.** All three are currently marked `minor`. `RELEASING.md`'s table reserves `major` for "a behavior change that existing callers will notice", and this PR's entire justification is that bare-markup callers *do* notice it (436px of overflow becomes two rows). The counter-argument — that it is a fix aligning CSS to a shipping default — only holds for `blocks-react`, not for the other two surfaces. The audit's own note: a published App Block rendering bare `data-civitai-ui="group"` as a deliberately horizontal-scrolling toolbar would start wrapping with no opt-in.

Left at `minor` because publishing `@civitai/components@1.0.0` off `0.3.1` is a product call, not a correctness one. **Flip all three to `major` before release if that is the intent.**
