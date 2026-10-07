---
'@civitai/sdk': patch
---

docs: the README's `auth: "oauth"` opt-in now names its two other conditions

The `initialize()` section said a block opts in to an OAuth token by declaring `auth: "oauth"`, and
left out two things the host enforces: the manifest must also declare `user:read:self` (every OAuth
token carries it, so without it the host never mints one and hands back the block token), and
`auth: "oauth"` cannot be declared alongside any `apps:storage:*` scope (such a manifest is refused
at submit). `@civitai/components-chat`'s README now links here instead of keeping its own copy.

Prose only, no behaviour change. A patch release because the README ships in the package.
