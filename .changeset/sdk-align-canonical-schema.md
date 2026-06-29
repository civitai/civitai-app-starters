---
"@civitai/app-sdk": minor
---

Align the App Block manifest schema and `defineBlock` runtime checks to the now-published canonical schema at https://civitai.com/schemas/app-block/v1.json (the single source of truth shared by the server validator and the `civitai` CLI).

- The vendored `schemas/app-block/v1.json` is now a byte-identical copy of the canonical (was a stale, divergent draft-07 copy), and a CI drift-check (`scripts/check-canonical-schema.sh` / `pnpm check:schema`) fails on any difference so it can't silently diverge again.
- `defineBlock` now enforces the canonical `blockId` rule: `/^[a-z][a-z0-9-]*[a-z0-9]$/`, length 3–40 (DNS-subdomain-safe, since the blockId becomes `<blockId>.civit.ai`) — tightened from the previous `/^[a-z0-9-]{3,64}$/`.
- `defineBlock` now validates `scopes` by **membership** in the canonical 10-scope enum (`BLOCK_SCOPES`), matching how the schema validates them — a well-formed but unknown scope (e.g. `models:read:all`) is now rejected. The `domain:verb:target` pattern is kept only as an error-message helper.

BREAKING-ish for authors: this can reject manifests that previously passed `defineBlock` — specifically blockIds that are 41–64 chars, start with a digit/hyphen, or end in a hyphen, and any scope not in the approved set. These would have been rejected server-side anyway; the SDK now surfaces them at `pnpm dev` time.
