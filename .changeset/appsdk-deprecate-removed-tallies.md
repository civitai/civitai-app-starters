---
'@civitai/app-sdk': patch
---

**The manifest types mark `counters`, `marks` and `write: "none"` as removed.** Types, JSDoc and schema descriptions only; nothing a manifest may declare changes.

civitai.com removed counters, marks, their tallies and the `write: "none"` policy they existed for (civitai/civitai#10391). It still accepts them on a collection the app's previous approved version already declared, so the types keep them:

- `BlockStorageSharedCollectionDeclaration.counters` and `.marks` are `@deprecated`, with the canonical schema's wording: use a viewer-keyed collection (`keyedBy`) instead; civitai.com serves no counters or marks; it refuses one the collection did not already declare.
- The `write` docs say `'none'` is REMOVED: refused on a collection that did not already declare it, and read-only where it is kept. Use `'own'` with `keyedBy` instead.
- The surrounding JSDoc, `defineBlock`'s `KNOWN_GAPS` text and the `apps:storage` scope note no longer present counters and marks as live.
- The vendored canonical schema (`schemas/app-block/v1.json`) is re-vendored from https://civitai.com/schemas/app-block/v1.json. The diff changes only the `write`, `counters` and `marks` descriptions and adds `deprecated: true` (an annotation) to the last two: no validation rule changes, so a manifest that validated before still validates.
