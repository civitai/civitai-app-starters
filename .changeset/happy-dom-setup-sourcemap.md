---
'@civitai/components': patch
---

**`@civitai/components/testing/happy-dom` no longer makes Vite warn about a missing source map.** The published module ended with `//# sourceMappingURL=happy-dom.js.map`, but the tarball left out every `.map` file, so each Vitest run that used it as a setup file printed `Failed to load source map … ENOENT`. The package now ships that one map, with its source inlined, so the comment points at a file that exists and stack traces through the shim show the original TypeScript. No other files change, and the shim behaves the same.
