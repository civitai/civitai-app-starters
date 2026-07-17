---
'@civitai/app-sdk': patch
---

Sync the App Block scope set to the canonical after civitai #3212 removed three decorative (declared-but-never-enforced) scopes: `media:read:owned`, `block:settings:read`, `block:settings:write`. Re-vendors the manifest schema mirror, drops the three entries from `BLOCK_SCOPES`, and updates the drift-guard test. A manifest declaring any of these is now rejected as unknown server-side, so `defineBlock` / `civitai app validate` now reject them locally too (previously they were falsely accepted). Restores parity with `https://civitai.com/schemas/app-block/v1.json`.
