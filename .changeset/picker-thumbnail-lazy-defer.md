---
'@civitai/blocks-react': patch
---

dev:live picker: defer off-screen thumbnail loads with an IntersectionObserver scoped to the grid

Native `loading="lazy"` does not defer images inside the picker's `overflow:auto` modal grid — the browser measures "near viewport" against the document viewport, and the whole modal sits within it, so all ~24 thumbnails fetched and decoded on open (the open-time main-thread freeze on real CDN images). The thumbnail `src` is now parked on `data-src` and promoted only when its card nears the grid's viewport (a +150px prefetch), via the same IntersectionObserver mechanism the infinite-scroll sentinel already uses. Guarded by a real-Chromium perf test (off-screen thumbnails stay deferred on open).
