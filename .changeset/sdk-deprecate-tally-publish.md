---
'@civitai/sdk': patch
---

**The document store's tallies and server-side publish are marked `@deprecated`, pointing at viewer-keyed documents.** Types and JSDoc only; no call, request or reply changes.

- `collection().update` (every overload) and its operator types `StorageIncrementOp`, `StorageMarkOp`, `StorageUnmarkOp` and `StorageUpdateOp` are deprecated. Counters, marks and the tally `PATCH` route are being removed from civitai.com. A vote, like or per-viewer entry is the viewer's own document in a viewer-keyed collection (`keyedBy`): use `getMine`, `putMine` and `deleteMine`, and count by listing with `keyPrefix`. A report goes through `app.moderation.report`.
- `increment`, `mark` and `unmark` were already deprecated, but their notes pointed at `update`, which is now being removed too. They now point at viewer-keyed documents.
- `publish`, `unpublish` and `StoragePublishRequest`, `StoragePublishSkipReason`, `StoragePublishResult` and `StorageUnpublishResult` are deprecated. Write the shared copies one by one with `put` / `delete` instead.
- The tally fields are deprecated: `StorageDocument.counters`, `.marks` and `.viewer`, `StorageCollectionInfo.counters` and `.marks`, and the list options `markedBy` and `mark`. The `sort` docs now say `counter:<name>` / `mark:<name>` are deprecated, and that there is no sort by count.
