---
'@civitai/sdk': minor
---

Add the App Blocks document store client: `app.storage.collection<T>(name)` with
`get`, `getMany`, `put` (with `ifVersion`), `create`, `delete` (with `ifVersion`),
`list` (one declared-index `where`, `sort`, `author: 'me'`, `markedBy: 'me'` +
`mark`, `keyPrefix`, `limit`, `cursor`), `increment`, `mark` and `unmark`, plus
`app.storage.info()` and a `StorageError` carrying the server's `code`, `status`,
`details` and `retryAfter`, over `/api/v1/blocks/storage/…`.

`@civitai/sdk/testing` gains `createFakeStorage({ manifest })`, an in-memory store
at the client's `Http` seam that enforces the server's storage rules and passes
the platform's storage contract. Its rate limits are opt-in
(`enforceRateLimits: true`), so an app's own tests are not throttled. As the
server does, it refuses withdrawing a `report` mark (`unmark(key, 'report')`) with
`invalid_request`, before sign-in or any rate budget.

A `401` whose body's `code` is `sign_in_required` is no longer retried with a
re-minted token: it is about the viewer, not the token, so the retry only cost a
second request. Every other `401` is still retried once.

The legacy key/value methods on `app.storage` (`get`, `set`, `delete`, `list`,
`getQuota`) and `app.sharedStorage` are now `@deprecated`, with no change in
behaviour; they keep working until apps have moved to collections.
