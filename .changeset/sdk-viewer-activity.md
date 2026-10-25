---
'@civitai/sdk': minor
---

A block now tells its host when the viewer uses it: after `initialize()` in a block, a `pointerdown`, `keydown`, `wheel` or `focusin` in the frame sends `VIEWER_ACTIVITY` (fire-and-forget, no payload) at most once a minute. Nothing about the event leaves the frame. civitai's App Assistant uses it to keep an app's sandbox awake while someone works in its live preview. Needs a host that lists `VIEWER_ACTIVITY` (civitai); an older host drops it, counted as unhandled.
