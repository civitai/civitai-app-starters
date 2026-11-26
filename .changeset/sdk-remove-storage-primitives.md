---
'@civitai/sdk': minor
---

**BREAKING: the document store's tallies, server-side publish and the legacy key/value stores are removed.** civitai.com stopped serving all of them: counters, marks, their tallies and publish in civitai/civitai#10391 (2026-11-25), the legacy `app-storage` and `shared-storage` routes on 2026-11-10 (`410`). Each was `@deprecated` since 0.30.1. This is a breaking change shipped as a `0.x` minor: a `^0.32` range does not pick it up.

Removed:

- `collection().update` (every overload; the tally `PATCH` now answers `405`) and its types `StorageIncrementOp`, `StorageMarkOp`, `StorageUnmarkOp`, `StorageUpdateOp`.
- `collection().increment`, `mark`, `unmark`, `publish` and `unpublish`, the types `StoragePublishRequest`, `StoragePublishSkipReason`, `StoragePublishResult`, `StorageUnpublishResult`, and the local error code `publish_unavailable`.
- The tally fields: `StorageDocument.counters`, `.marks` and `.viewer`; `StorageCollectionInfo.counters` and `.marks`; `StorageLimits.rate.marksAndCountersPerMinute`. The list options `markedBy` and `mark`, and the `counter:<name>` / `mark:<name>` sorts.
- The legacy key/value methods on `app.storage` (`get`, `set`, `delete`, `list`, `getQuota`) and `app.sharedStorage`, with their types (`StorageClient`, `StorageCallOptions`, `StorageKeyEntry`, `StorageListQuery`, `StorageListResult`, `StorageQuota`, `SharedStorageClient`, `SharedItem`, `SharedListQuery`, `SharedListResult`, `SharedStorageCallOptions`, `SharedValue`). `app.storage` is the document store only: `collection(name)`, `info()` and `mode`.
- `@civitai/sdk/testing`: `createFakeStorage`'s `publish` option. The fake now answers the removed routes as civitai.com does (`PATCH` 405; counters, marks, `_publish` and `_unpublish` 404; `markedBy` / `mark` and tally sorts refused; a `write: "none"` collection read-only), as does the dev-tunnel local preview.

`collection().mark` is removed entirely, `report` included: a report goes through `app.moderation.report`. civitai.com still answers `PUT …/:key/marks/report` as a report, but only for apps already built on SDKs before 0.30; `createFakeStorage` and the local preview answer it `404`, as every other mark.

Works against today's server: a document reply's leftover `counters: {}`, `marks: {}` and `viewer` (and `info()`'s `counters: []`, `marks: []`, `marksAndCountersPerMinute: 0`), which civitai.com still sends for older SDKs, are ignored, as is any field the client does not name.

Moving off them:

- A vote, like or per-viewer entry is the viewer's own document in a viewer-keyed collection (`keyedBy: "viewer"` or `"parent+viewer"`): `getMine`, `putMine`, `deleteMine`. Count by listing with `keyPrefix: '<parent>:'`; there is no sort by count.
- A report is `app.moderation.report({ collection, key, from? })`.
- Publishing private documents: read them and `put` each shared copy.
- The legacy stores: a `private` collection for per-viewer data, a `shared` one for cross-viewer data (https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores).
