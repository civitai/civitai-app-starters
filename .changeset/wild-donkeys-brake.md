---
'@civitai/components': patch
---

Slice `src/components.css` per component at build time, as internal artifacts. The build now also writes one standalone, layered stylesheet per `/* ----- Name ----- */` section to `dist/css/<slug>.css` (plus a JS-injectable string compiled from `src/css/<slug>.generated.ts`). The split is asserted **byte-identical on reassembly** against the source sheet before any artifact is written, with a negative control in the test suite.

**No public API change — `patch`, not `minor`.** These files ship inside the tarball but are deliberately NOT declared in `exports`: `@civitai/components/css/button` does not resolve, and the package still exports exactly `.` and `./styles.css`. Files are reversible; an `exports` key on a published package is not, and nothing imports these yet. Whether to open the surface — and in what shape — is issue #358, which `pnpm measure:css-split` prices from these real artifacts. Treat `dist/css/*` as private and unstable.

`componentsCss`, `injectStyles()`, `dist/components.css` and the package-root `styles.css` are byte-identical to before and still carry the whole sheet, because `@civitai/blocks-react`'s `useBlocksStyles()` injecting the whole pack is a documented contract (`MARKUP.md`): rendering any one `/ui` component styles hand-written `data-civitai-ui="…"` markup elsewhere on the page. Nothing in `@civitai/blocks-react` changed.
