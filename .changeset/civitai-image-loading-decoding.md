---
'@civitai/components': minor
---

`<civitai-image>` now passes `loading` and `decoding` through to its `<img>`.

The `<img>` is built inside the element's shadow root, so nothing in the
consuming page could reach those attributes — an app rendering a grid of tiles
had no way to say `loading="lazy"` and got an eager decode for every off-screen
one. Both are plain passthroughs: unset renders no attribute at all, so the
default stays HTML's and no existing markup changes behaviour.
