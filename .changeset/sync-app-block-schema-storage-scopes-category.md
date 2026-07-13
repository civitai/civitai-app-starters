---
'@civitai/app-sdk': minor
---

Sync the vendored App Block manifest schema + SDK constants with the canonical server-published schema (https://civitai.com/schemas/app-block/v1.json). Adds the two 4-segment shared-storage scopes `apps:storage:shared:read` / `apps:storage:shared:write` to `BLOCK_SCOPES` and the schema's `scopes` enum, widens `BLOCK_SCOPE_PATTERN` to accept 4 colon segments (now only a format heuristic — membership is enforced against `BLOCK_SCOPES`), and adds the optional `category` manifest field backed by a new `BLOCK_CATEGORIES` const + `BlockCategory` type (the 7 marketplace categories). `defineBlock` now rejects a well-formed-but-unknown category and validates `category` against the canonical set. The schema↔`BLOCK_SCOPES` parity test is now a real drift guard (Set equality), extended to cover the category enum. Additive for authors; the only new rejection (`category` must be a known value) matches what the server already enforces.
