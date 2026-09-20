---
'@civitai/components': minor
---

Ship per-component CSS. `src/components.css` is now also sliced along its existing `/* ----- Name ----- */` section markers into 14 standalone, layered stylesheets, reachable through 21 new subpath exports — `@civitai/components/css/<component>` for the JS-injectable string and `@civitai/components/css/<component>.css` for the file, one for every name in `COMPONENT_NAMES` (plus `tabs`). Components that share a section share a slice, so `text-input`, `textarea`, `number-input` and `select` resolve to the same module and a bundler dedupes them.

Measured with esbuild (minify, ESM, React external), a `@civitai/blocks-react/ui` Button bundle is 52,568 B of which 50,151 B is stylesheet; over Button's and Loader's slices instead it is 13,480 B.

**Backward compatible by design.** `componentsCss`, `injectStyles()`, `dist/components.css` and the package-root `styles.css` are byte-identical to before and still carry the whole sheet, because `@civitai/blocks-react`'s `useBlocksStyles()` injecting the whole pack is a documented contract (`MARKUP.md`): rendering any one `/ui` component styles hand-written `data-civitai-ui="…"` markup elsewhere on the page. Nothing in `@civitai/blocks-react` changed. Whether `/ui` should switch to slices is issue #358.

The split is asserted **byte-identical on reassembly** against `src/components.css` before any artifact is written, with a negative control in the test suite.
