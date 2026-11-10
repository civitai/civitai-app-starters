---
'@civitai/sdk': patch
---

Docs: the legacy stores are documented as removed. civitai.com removed the legacy app storage and shared storage on 2026-11-10: a request to any `/api/v1/blocks/app-storage/*` or `/api/v1/blocks/shared-storage/*` route that passes the block-token and scope checks is answered `410` with `{ error: 'legacy_store_removed', message, docs }`, so the deprecated `app.storage.get`/`set`/`delete`/`list`/`getQuota` and every `app.sharedStorage` method reject with an `ApiError` whose `status` is `410`. Move the app to the document store: https://developer.civitai.com/apps/guide/storage#moving-from-the-legacy-stores.

- `BREAKING.md` and the README no longer say the legacy stores keep working. Their *App storage* and *Shared storage* sections open with a removal note, and the rest of each section describes the store as it behaved before the removal.
- The `@deprecated` TSDoc on `StorageClient.get`/`set`/`delete`/`list`/`getQuota`, `AppClient.storage`, `AppClient.sharedStorage` and `SharedStorageClient` (which your editor shows from the shipped `.d.ts`) now says the store was removed and links the migration guide, in place of "keeps working, unchanged".

No code change.
