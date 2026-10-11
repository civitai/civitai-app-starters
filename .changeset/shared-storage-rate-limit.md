---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**Rate-limited shared-storage writes now say when to retry (#597).** When the server refuses a shared write because the viewer's per-app budget is empty, `useSharedStorage()`'s `append`, `update`, `vote`, `unvote`, `withdraw` and `report` reject with the new **`SharedStorageRateLimitError`**, carrying `retryAfterSeconds` (whole seconds, at least 1) and `retryAt` (an ISO-8601 instant). It extends `Error`, the class every other shared-storage refusal is thrown as, so existing `catch` code keeps working and `.message` is still the server's text (`Too many submissions — retry in 312s`). A refusal without the metadata (an older host, or a refusal that is not a rate limit) is still a plain `Error`.

- `@civitai/app-sdk`: new type `SharedStorageRateLimit` on `./blocks`, and an optional `rateLimit?: SharedStorageRateLimit` on the six shared write replies (`SHARED_APPEND_RESULT`, `SHARED_UPDATE_RESULT`, `SHARED_VOTE_RESULT`, `SHARED_UNVOTE_RESULT`, `SHARED_WITHDRAW_RESULT`, `SHARED_REPORT_RESULT`).
- **Tolerant transport.** No reply validator checks `rateLimit`, so it can never cause a reply to be dropped. A malformed one (wrong types, a non-integer or a value below 1, a missing field, an unparseable `retryAt`, a non-object) is stripped and the refusal arrives as a plain `Error`. A valid one is narrowed to its two fields.
- **`dev:live`** forwards `error.data.rateLimit` from the tRPC refusal onto the bridge reply. It does not retry a shared-storage write: only POLL retries transient statuses, and a 429 on POLL is still retried.
- **Mock host:** new `shared.rateLimitNext` (refuse the next N writes as rate-limited) and `shared.rateLimit` (`{ retryAfterSeconds?, retryAt? }`, defaulting to 60 s from now), both settable through `setScenario`.
- README: the shared write budget (append and update share a burst of 10 refilling one per 6 minutes plus 50 a day; refused writes are charged to a rejection budget of 10 refilling one per 30 minutes), the refusal shape and how to handle the error. That budget goes live with the next civitai.com release; until then the limit is 20 posts and edits a day.
