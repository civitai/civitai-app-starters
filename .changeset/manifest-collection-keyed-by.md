---
'@civitai/app-sdk': minor
---

A shared `write: "own"` storage collection may declare `keyedBy` (viewer-keyed documents).

- `BlockStorageSharedCollectionDeclaration` gains `keyedBy?: 'viewer' | 'parent+viewer'`. The server derives each document's key from the signed-in viewer, so each viewer has at most one document (`'viewer'`) or at most one per parent key the app names (`'parent+viewer'`), read and written at `/:collection/@me` or `/:collection/@me/:parent`.
- The vendored `schemas/app-block/v1.json` is re-vendored, so `defineBlock` accepts `keyedBy` on a shared `write: "own"` collection of kind `"docs"`, and refuses any other value, the field on a private collection, under `write` `"anyone"` / `"owner"` / `"none"`, on a `kind: "log"` collection, and beside `counters` or `marks`.
- `keyedBy` cannot be added, removed or changed on a collection any approved version declared. That needs the previously approved manifests, so it is checked at submit, not here: see `KNOWN_GAPS['storage-keyedBy-immutable']`.
- The re-vendored schema also rewords `hook`: it is in a limited rollout, accepted only from the authors the rollout includes, rather than refused for everyone. The SDK's docs follow.

Additive for authors: a manifest that validated before still validates.
