---
'@civitai/components-chat': patch
---

docs: the README listed "a block on civitai.com" as a plain way to sign the chat in, and by default it does not work

The Signing in table offered `await initialize()` in a block, with the manifest asking for
`ai:write:budgeted`, as one of three equal setups. The chat sends `app.getToken()` straight to the
orchestrator (its chat model, its MCP and its workflow routes), and the token a block holds by
default is the block-scoped one, which the orchestrator accepts on no route; `@civitai/sdk`'s own
README says the same. So in a block with the default token every reply is refused.

The README now says the chat needs an OAuth access token, that a block gets one only by declaring
`auth: "oauth"` (with `user:read:self` and `ai:write:budgeted`) for a signed-in viewer where the
host's OAuth mint is enabled, that there is no host-proxied route for the chat, and that its
generations then skip the controls the block workflow routes add.

Prose only, no behaviour change. A patch release because the README ships in the package.
