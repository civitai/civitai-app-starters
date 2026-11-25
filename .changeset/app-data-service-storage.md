---
'@civitai/sdk': minor
'@civitai/app-sdk': minor
---

**`app.storage` can send the document store through the app-data service, when the host says so.** Additive: without the new init field nothing changes.

- `BLOCK_INIT` gains an optional `appData: { url, slug }` (`@civitai/app-sdk` `BlockInitPayload`): the service's `https:` base URL and the app's blockId. The host sets it only for an app it has moved to the service, with a production token. Any other shape reads as absent. `initialize()` reads it once; a local preview (`storageMode: 'local-preview'`) wins over it.
- With it, while the frame holds a block token (`token.kind === 'block'`, read on every call), `app.storage.collection(name)` (this app's own collections) and `app.storage.info()` go to `<url>/v1/apps/<slug>/collections/<name>/records[/<key> | /@me[/<parent>]]` and `<url>/v1/apps/<slug>/info`, with the same bodies. If the host switches the frame to an OAuth token, the next call goes to civitai.com again. A collection opened through an import (`{ from }`), `update` and the deprecated `increment`, `mark`, `unmark`, `publish` and `unpublish`, `app.moderation`, the legacy key/value methods and `app.sharedStorage` stay on civitai.com.
- Read-your-writes, per collection: each collection remembers the highest `seq` a write to it was answered with, and its reads send that as `?minSeq=`. Another collection's write never raises it.
- Retries: a read answered `503` with a `Retry-After` of at most 5 s is sent again, up to 3 times, unless its code is one no wait clears (`unkeyed`, `too_large`, `registry_off`). A write is resent only on `503 not_forwarded` (refused before it reached the store). `504 outcome_unknown` is never resent: that write may have landed. `401 block_token_spent` is read again with a fresh block token, once.
- `getMany` has no route on the service: it sends keyed gets, at most 4 at once, in the order of `keys`, and stops at the first failure.
- What the service's answers carry: a private collection's document has only `key` and `data`, so it reads as the viewer's own (`author: { kind: 'user', isViewer: true }`) at `version: 0`, with both timestamps at the epoch. `0` is never a stored version, so an `ifVersion` built from it is refused `version_conflict` rather than overwriting. A shared document's author has no `kind`, and reads as `{ kind: 'user', isViewer }`.
- A private list comes back from the service whole, so the SDK pages it: key order, `limit` (default 25, at most 100) and a key cursor (`ka~~<key>` / `kd~~<key>`).
- Transitional: a list with `where`, `markedBy` / `mark`, or a sort other than `key` / `-key` goes to civitai.com, which serves them; the service does not yet.
- `StorageErrorCode` gains the service's codes: `not_forwarded`, `outcome_unknown`, `floor_not_met`, `block_token_spent`, `not_supported_here`, `stale_major`, and its read refusals (`token_not_exchangeable`, `invalid_token`, `exchange_refused`, `refused`, `revoked`, `capacity`, `token_capacity`, `cooling_down`, `not_live`, `stalled`, `ended`, `closed`, `failed`, `block_cache_full`, `unkeyed`, `not_resolved`, `unverifiable`, `not_private`). A read refusal whose code the service puts in `error` (it sends no `code` there) is a `StorageError` with that code.
- New exported type: `AppDataService` (`BlockSnapshot.appData`).
