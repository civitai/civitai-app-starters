---
'@civitai/sdk': minor
---

Add the App Blocks document store client: `app.storage.collection<T>(name)` with
`get`, `getMany`, `put` (with `ifVersion`), `create`, `delete` (with `ifVersion`),
`list` (one declared-index `where`, `sort`, `author: 'me'`, `markedBy: 'me'` +
`mark`, `keyPrefix`, `limit`, `cursor`), `increment`, `mark` and `unmark`, plus
`app.storage.info()` and a `StorageError` carrying the server's `code`, `status`,
`details` and `retryAfter`. It targets `/api/v1/blocks/storage/…`, which is not
live on civitai.com yet; until it is, every call rejects with a plain `404`.

`@civitai/sdk/testing` gains `createFakeStorage({ manifest })`, an in-memory store
at the client's `Http` seam that enforces the server's storage rules and passes
the platform's storage contract.

The legacy key/value methods on `app.storage` (`get`, `set`, `delete`, `list`,
`getQuota`) and `app.sharedStorage` are now `@deprecated`, with no change in
behaviour; they keep working until apps have moved to collections.
