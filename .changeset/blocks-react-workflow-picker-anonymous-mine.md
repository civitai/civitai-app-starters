---
'@civitai/blocks-react': patch
---

`WorkflowPicker`: an anonymous viewer on the "mine" list is told to sign in after one catalog request, with no `REQUEST_TOKEN` to the host. Before, every such search refreshed the block token and searched again, which counted twice against the catalog rate limit. A signed-in viewer's expired token, and any `401` on "All", still refresh once and retry.
