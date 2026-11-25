---
'@civitai/sdk': minor
'@civitai/app-sdk': minor
---

**`app.storage` can send the document store through the app-data service, when the host says so.** Additive: without the new init field nothing changes.

- `BLOCK_INIT` gains an optional `appData: { url, slug }` (`@civitai/app-sdk` `BlockInitPayload`): the service's `https:` base URL and the app's blockId. The host sets it only for an app it has moved to the service, with a production token. Any other shape reads as absent. `initialize()` reads it once; a local preview (`storageMode: 'local-preview'`) wins over it.
- With it, `app.storage.collection(name)` (this app's own collections) and `app.storage.info()` go to `<url>/v1/apps/<slug>/collections/<name>/records[/<key> | /@me[/<parent>]]` and `<url>/v1/apps/<slug>/info`, with the same bodies. A collection opened through an import (`{ from }`), the deprecated `increment`, `mark`, `unmark`, `publish` and `unpublish`, `app.moderation`, the legacy key/value methods and `app.sharedStorage` stay on civitai.com.
- Read-your-writes: each write answer's `seq` is remembered (the highest, app-wide), and every read sends it as `?minSeq=`.
- Retries: a read answered `503` with a `Retry-After` of at most 5 s is sent again, up to 3 times. A write is resent only on `503 not_forwarded` (refused before it reached the store). `504 outcome_unknown` is never resent: that write may have landed. `401 block_token_spent` is read again with a fresh block token.
- `getMany` has no route on the service: it sends keyed gets, at most 4 at once, in the order of `keys`.
- What the service's answers carry: a private collection's document has only `key` and `data`, so it reads as the viewer's own (`author: { kind: 'user', isViewer: true }`) at `version: 0`, with both timestamps at the epoch. `0` is never a stored version, so an `ifVersion` built from it is refused `version_conflict` rather than overwriting. A private list is the whole collection (`nextCursor: null`), in key order. A shared document's author has no `kind`, and reads as `{ kind: 'user', isViewer }`.
- A list with `where`, `markedBy` / `mark`, or a sort other than `key` / `-key` is refused before sending, `not_supported_here` (400): a private collection on the service would ignore the filter and answer every document.
- `StorageErrorCode` gains the service's codes: `not_forwarded`, `outcome_unknown`, `floor_not_met`, `block_token_spent`, `not_supported_here`, `stale_major`, and its read refusals (`token_not_exchangeable`, `invalid_token`, `exchange_refused`, `refused`, `revoked`, `capacity`, `token_capacity`, `cooling_down`, `not_live`, `stalled`, `ended`, `closed`, `failed`, `block_cache_full`, `unkeyed`, `not_resolved`, `unverifiable`, `not_private`). A read refusal whose code the service puts in `error` (it sends no `code` there) is a `StorageError` with that code.
- New exported type: `AppDataService` (`BlockSnapshot.appData`).
