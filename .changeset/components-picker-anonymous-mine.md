---
'@civitai/components': minor
---

`blockTokenSource` takes an optional `signedIn()`. When it returns `false`, a `401` on a `mine` search ends as `unauthorized` straight away, without calling `getToken({ fresh: true })`: the catalog answers an anonymous viewer's `mine` with a `401`, and a new token would get the same answer. Every other `401`, and every `401` when `signedIn` is absent or returns `undefined`, still gets the one fresh-token retry.
