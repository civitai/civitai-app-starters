---
'@civitai/blocks-react': patch
---

`WorkflowPicker`: an anonymous viewer on the "mine" list no longer sends a `REQUEST_TOKEN` to the host before being told to sign in, so the sign-in message shows straight after the catalog's `401` instead of after that round trip. The catalog request count is unchanged: a host answers `REQUEST_TOKEN` with the token it already holds, so no second request was sent before either. A signed-in viewer's `401`, and any `401` on "All", still ask for a fresh token once and retry if it differs.
