---
"@civitai/app-sdk": minor
---

Add color-domain maturity to the App Blocks contract. `BlockInitPayload` now
carries optional `domain` (`green`|`blue`|`red`|`null`) and `maxBrowsingLevel`
(an authoritative browsing-level bitmask) projected by the host (civitai #2670).
Adds a `browsingLevel` module: per-level `BrowsingLevel` bit constants (mirroring
the server `NsfwLevel`), `SFW_LEVELS`/`NSFW_LEVELS` flags, and pure
`isSfwCeiling(maxBrowsingLevel?)` / `isLevelAllowed(level, maxBrowsingLevel?)`
helpers that derive SFW from the bitmask (policy stays server-side) and
**fail-closed to SFW** when the ceiling is absent/non-finite. Additive only.
