---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**`BLOCK_READY` now reports which SDK the block was built with, and its version.**

The `BLOCK_READY` payload gains two optional fields:

- `sdkName`: which package's transport sent the message. `'blocks-react'` for `@civitai/blocks-react`, `'sdk'` for `@civitai/sdk`. The two packages version independently, so a version alone cannot tell them apart.
- `sdkVersion`: that package's plain semver (for example `"0.73.0"`, with no package name and no `v`).

Both transports now send them, so the host can see which SDK versions are in use.

They are informational. Neither is a protocol version and nothing is negotiated on them. They are optional in both directions: blocks built before this release omit them, and a host that does not read them ignores them. No migration is needed.

`@civitai/app-sdk`: type only. `BlockToParentMessage`'s `BLOCK_READY` payload is now `{ height: number; sdkVersion?: string; sdkName?: 'blocks-react' | 'sdk' }`.
