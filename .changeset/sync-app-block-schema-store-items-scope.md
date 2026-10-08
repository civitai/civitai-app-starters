---
'@civitai/app-sdk': minor
---

Sync the vendored App Block manifest schema + SDK constants with the canonical server-published schema (https://civitai.com/schemas/app-block/v1.json). Adds the 4-segment App Store sub-listing scope `apps:store:items:write` (civitai/civitai#5511 — publish the viewer's own app items as store cards under the calling app) to `BLOCK_SCOPES` (`APPS_STORE_ITEMS_WRITE`) and the schema's `scopes` enum, and names it in the schema's `scopeJustifications` sensitive-scope list. The scope is SENSITIVE (a declaring manifest must justify it, or the server rejects it at submit — not checked by `defineBlock`, see `KNOWN_GAPS`) and consent-exempt on the server (gated per call). Additive for authors: `defineBlock` now accepts a manifest declaring it; nothing previously accepted is rejected.
