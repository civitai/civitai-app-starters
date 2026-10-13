---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**`BLOCK_READY` now reports the SDK version.**

The `BLOCK_READY` payload gains an optional `sdkVersion`: the plain semver of the package whose transport sent the message (for example `"0.73.0"`, with no package name and no `v`). `@civitai/blocks-react`'s `IframeTransport` now sends its own version there, so the host can see which SDK versions are in use.

It is informational. It is not a protocol version and nothing is negotiated on it. It is optional in both directions: blocks built before this release omit it, and a host that does not read it ignores it. No migration is needed.

`@civitai/app-sdk`: type only. `BlockToParentMessage`'s `BLOCK_READY` payload is now `{ height: number; sdkVersion?: string }`.
