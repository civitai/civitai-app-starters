---
'@civitai/sdk': minor
---

A block's `initialize()` now refuses a block-scoped token for a signed-in
viewer: `/api/v1`, the orchestrator and the MCP reject that token, so the SDK
throws a `CivitaiError` up front pointing at the fix, `auth: "oauth"` in
`block.manifest.json`. With that opt-in the host hands over a real OAuth access
token, and consent goes through the host's dialog. `WrappedToken` and
`BlockToken` gain `kind?: 'block' | 'oauth'`; a host that predates the field
sends none, and the SDK then behaves as before.
