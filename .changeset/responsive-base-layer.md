---
'@civitai/components': minor
'@civitai/components-react': minor
'@civitai/blocks-react': minor
---

Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

⚠️ **Upgrading — one visible layout change.** A `group` row now **wraps** instead of overflowing, and its children may shrink. If you relied on a group staying on one line — a deliberately horizontal-scrolling toolbar, for example — add `data-nowrap="true"` to restore the previous behaviour:

```html
<div data-civitai-ui="group" data-nowrap="true">…</div>
```

This affects bare markup and `@civitai/components-react`'s `<Group>`. `@civitai/blocks-react`'s `<Group>` is unchanged — it already wrapped.

**`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

There are **three** `group` surfaces, and they did not agree:

- `@civitai/blocks-react`'s `<Group>` defaults `wrap = true` and writes `flex-wrap` as an *inline* style — its consumers have always wrapped;
- `@civitai/components-react`'s `<Group>` writes no inline style at all and has no `wrap` prop, so it resolved against the CSS;
- bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve — likewise.

The CSS carried no `flex-wrap`, so the latter two did not wrap. Nothing could see it, because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 320px box**. They now reflow onto two rows and fit, and a test pins the CSS default against the rendered React default so they cannot drift apart again.

**Be precise about what this is:** for `blocks-react` it aligns the CSS to a default that was already shipping, but for `@civitai/components-react` and for bare markup it is a genuinely **new default**.

`min-width: 0` lets one long unbroken label narrow instead of pushing the whole row past its container. It applies to a child with the default `overflow: visible`; per CSS Flexbox §4.5 a child with any other `overflow` already has an automatic minimum size of 0.

**`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

---

**Bump level: `minor`, decided — not an open question.**

An adversarial audit recommended `major` for `@civitai/components`, on the grounds that `RELEASING.md` reserves it for "a behavior change that existing callers will notice" and this change is justified precisely by the fact that they do notice (436px of overflow becomes two rows). That reading is sound; it was considered and **the maintainer chose `minor`**, since publishing `@civitai/components@1.0.0` off `0.3.1` is a product decision rather than a correctness one.

Recorded so a later reader knows this was weighed rather than missed, and so the trade-off is visible: shipping as `minor` means **this changelog entry is the only warning consumers get**, which is why the upgrade note is at the top rather than buried here. The concrete case it exists for is a published App Block rendering bare `data-civitai-ui="group"` as a deliberately horizontal-scrolling toolbar — that starts wrapping, and `data-nowrap="true"` is the one-attribute fix.
