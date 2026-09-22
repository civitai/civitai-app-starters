---
'@civitai/components': minor
---

Add `<civitai-sign-in-button>`, the first element that acts as the viewer
through `@civitai/sdk`. It starts the host's sign-in flow inside a civitai.com
page and is inert until `BLOCK_INIT`: with no validated host origin a press
sends nothing, and the control renders disabled.

It has its own entry points, `@civitai/components/civitai-sign-in-button` and
`/define`, and is left out of `register`, `elements.js` and `site-elements.js`,
so a page that wants only the look never bundles the SDK. `@civitai/sdk` is an
optional peer dependency: install it only to use this element.
