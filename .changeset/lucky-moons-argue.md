---
'@civitai/components': minor
---

Add `<civitai-sign-in-button>`, the first element that acts as the viewer
through `@civitai/sdk`. Inside a civitai.com page it asks the host, and is
inert until `BLOCK_INIT`: with no validated host origin a press sends nothing,
and the control renders disabled. Given a `signIn` from the SDK's
`createSignIn()`, the same button leaves for Civitai itself, so an app outside
civitai.com gets one button for both.

It has its own entry points, `@civitai/components/civitai-sign-in-button` and
`/define`, and is left out of `register`, `elements.js` and `site-elements.js`,
so a page that wants only the look never bundles the SDK. `@civitai/sdk` is an
optional peer dependency: install it only to use this element.

`variant`, `size` and `full-width` pass through to the button it wraps.
