---
'@civitai/app-sdk': minor
---

Sync the vendored App Block manifest schema + SDK constants with the canonical server-published schema (https://civitai.com/schemas/app-block/v1.json). Adds the three App Blocks Collections scopes `collections:read:self`, `collections:write:self`, and `collections:read:private` to `BLOCK_SCOPES` and the schema's `scopes` enum. All three are 3-segment, so the existing `BLOCK_SCOPE_PATTERN` already accepts them (no widening needed — that was the `apps:storage:shared:*` sync in #131). The schema↔`BLOCK_SCOPES` parity/drift-guard test and the `defineBlock` scope-acceptance tests are extended to cover the three additions. Purely additive for authors — these scopes are now declarable in a manifest and validated by membership; the server continues to gate them per-op (collection visibility/ownership + maturity clamp on read, self-bound actor on follow/write, explicit consent for `collections:read:private`).
