---
'@civitai/sdk': patch
'@civitai/blocks-react': patch
---

Classify the two refusals civitai.com now sends when a publishing call needs the
viewer's signed-in session. A bare `UNAUTHORIZED` (the session ended, e.g.
signed out in another tab) is now `unauthenticated` in `@civitai/sdk` and sets
`CreatePostError.signInRequired` in `@civitai/blocks-react`, so an app offering
sign-in on that branch shows it instead of "unavailable". "…belongs to a
different account; reload the page to continue" is now `forbidden` in
`@civitai/sdk`; its message tells the viewer to reload. Existing mappings are
unchanged.
