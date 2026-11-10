---
'@civitai/app-sdk': minor
---

A storage collection may declare `hook` (civitai/civitai#7832). RESERVED: civitai.com refuses the field until permission hooks are enabled, so do not declare it yet. This release types it and re-vendors the schema only; it adds no hook behaviour.

- New `BlockStorageCollectionHook`: `{ file: string; sha256: string; timeoutMs?: number }`, the canonical `$defs.storageCollectionHook`. `file` is the hook module's relative path in the bundle (`/`-separated segments, ending `.js` or `.mjs`, at most 200 characters, no `.`/`..` segment, hidden file, leading `/` or `node_modules` segment). `sha256` is 64 lowercase hex characters. `timeoutMs` is an integer from 1 to 500 (omitted means 50).
- `BlockStoragePrivateCollectionDeclaration` and `BlockStorageSharedCollectionDeclaration` gain `hook?: BlockStorageCollectionHook`. The canonical allows it on every collection kind.
- The vendored `schemas/app-block/v1.json` is re-vendored from https://civitai.com/schemas/app-block/v1.json, so `defineBlock` accepts a well-formed `hook` and refuses a malformed one. Like the other RESERVED features, it validates offline and is refused at submit; the server alone checks that `file` is outside `outputDir`, is in the bundle with that `sha256`, and its size: see `KNOWN_GAPS['storage-server-only-rules']`.

Additive for authors: a manifest that validated before still validates.
