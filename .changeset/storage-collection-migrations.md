---
'@civitai/app-sdk': minor
---

Storage collection migrations (civitai/civitai#7661). A storage collection may declare `migrations`: 1 to 32 declarative ops civitai.com applies to the documents already stored when a version that narrows the collection's `schema` is approved. Without a covering op, a breaking schema change (a newly required property, a narrowed type, enum, const, bound or pattern, `additionalProperties` closed, a declared property removed under `additionalProperties: false`, or a first schema on a collection) is refused at submit. Needs the civitai.com release that serves it.

- New types `BlockStorageMigrationOp` (`{ op: 'default', path, value }` | `{ op: 'rename', from, to }` | `{ op: 'remove', path }` | `{ op: 'acknowledge', path, keyword }`) and `BlockStorageMigrationKeyword`, exported from `./blocks` and `./manifest`. `migrations?: BlockStorageMigrationOp[]` is added on both collection declarations.
- The vendored `schemas/app-block/v1.json` is re-vendored, so `defineBlock` accepts `migrations` and enforces each op's shape, its JSON Pointer paths, and that a `write: "none"` collection declares none. Whether an op covers a breaking change needs the previous approved manifest, so that is decided at submit: see `KNOWN_GAPS['storage-migrations-server-only-rules']`.

Additive for authors: a manifest that validated before still validates.
