---
'@civitai/app-sdk': minor
---

**`BlockManifestV1` gains the optional `analytics` (custom events) declaration.** `analytics.events` maps an event name to an optional `description` and a `properties` map, and each property is `{ type: 'enum', values: string[] }`, `{ type: 'number' }` or `{ type: 'boolean' }`. There is no free-text string type. New exported types from `@civitai/app-sdk/blocks` and `@civitai/app-sdk/manifest`: `BlockAnalyticsDeclaration`, `BlockAnalyticsEventDeclaration` and `BlockAnalyticsPropertyDeclaration`.

- **Types only.** The name pattern and the count and length limits are documented on the type, not expressed in it.
- **`defineBlock` does not validate `analytics` yet.** It validates against the vendored copy of the published schema, which does not declare `analytics` yet, so the value is accepted unchecked. Validation arrives with the scheduled schema re-vendor. The platform's manifest validator is authoritative.
- Additive: nothing previously accepted is rejected.
