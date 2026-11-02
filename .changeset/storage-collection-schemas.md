---
'@civitai/sdk': minor
'@civitai/app-sdk': minor
---

Collection document schemas (civitai/civitai#7491). A storage collection may declare `schema`, a JSON Schema subset that every document's `data` must match. The server refuses a create or put that does not match with 400 `schema_violation`, and `details: { collection, pointer, keyword }` names the first failing JSON pointer. Counters and marks are not checked.

- `@civitai/sdk`: `StorageErrorCode` gains `'schema_violation'`. `createFakeStorage`, and with it the dev-tunnel local preview, now enforces a collection's `schema` the way the server does: the same messages, pointers and order, checked before the ownership check, the trust gate, the write budget and moderation. It also refuses at creation a schema the server would refuse at submit, with the server's text, including more than 32 patterns across the manifest. The vendored storage contract is re-vendored.
- `@civitai/app-sdk`: `schema?: BlockStorageCollectionSchema` is added on both collection declarations, with the new `BlockStorageCollectionSchema` and `BlockStorageSchemaType` types. The vendored `schemas/app-block/v1.json` is re-vendored, so `defineBlock` accepts `schema` and enforces the subset's shape. The server-only bounds (size, depth, pattern count per schema and per manifest, min above max, a pattern that compiles and cannot backtrack catastrophically) are refused at submit, not here: see `KNOWN_GAPS['storage-collection-schema-server-only-rules']`.
