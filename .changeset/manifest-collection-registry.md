---
'@civitai/app-sdk': minor
---

A shared storage collection may declare `registry` (civitai/civitai#7931). RESERVED: civitai.com refuses the field until publishing to registries is enabled, so do not declare it yet.

- `BlockStorageSharedCollectionDeclaration` gains `registry?: 'public'`. `'public'` publishes the collection's visible shared documents, read-only, to every registry that follows Civitai's apps, as entities of the collection's schema; hidden documents and every private document never leave. Absent (the default), the collection is not published.
- The vendored `schemas/app-block/v1.json` is re-vendored, so `defineBlock` accepts `registry: "public"` on a shared collection and refuses any other value, and refuses the field on a private collection. Like the other RESERVED features, it validates offline and is refused at submit: see `KNOWN_GAPS['storage-server-only-rules']`.

Additive for authors: a manifest that validated before still validates.
