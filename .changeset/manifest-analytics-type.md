---
'@civitai/app-sdk': minor
---

**The manifest gains an optional `analytics` (custom events) declaration, typed and validated.** `analytics.events` maps an event name to an optional `description` and a `properties` map, and each property is `{ type: 'enum', values: string[] }`, `{ type: 'number' }` or `{ type: 'boolean' }`. There is no free-text string type.

- **Types.** `BlockManifestV1.analytics`, plus the exported `BlockAnalyticsDeclaration`, `BlockAnalyticsEventDeclaration` and `BlockAnalyticsPropertyDeclaration` from `@civitai/app-sdk/blocks` and `@civitai/app-sdk/manifest`.
- **Schema.** Re-vendors the canonical App Block manifest schema from https://civitai.com/schemas/app-block/v1.json, which now declares `analytics`. `defineBlock` validates against it: event and property names must match `^[a-z][a-z0-9_]{0,63}$`; at most 50 events and 10 properties per event; an enum declares 1 to 50 distinct non-empty values of at most 64 characters; a `description` is at most 200 characters; no other keys are allowed at any level.
- 🔴 **This is a tightening, which is why the bump is `minor`.** The schema root allows undeclared keys, so until now a top-level `analytics` key of any shape passed `defineBlock` unvalidated. A manifest that already carries an `analytics` key that does not match the declaration above now fails.
- The platform's manifest validator remains authoritative.
