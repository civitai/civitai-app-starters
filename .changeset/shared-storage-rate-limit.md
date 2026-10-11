---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**Rate-limited shared-storage writes now say when to retry (#597).** When the server refuses a shared write because the viewer's per-app budget is empty, `useSharedStorage()`'s `append`, `update`, `vote`, `unvote`, `withdraw` and `report` reject with the new **`SharedStorageRateLimitError`**, carrying `retryAfterSeconds` (whole seconds, at least 1) and `retryAt` (an ISO-8601 instant). It extends `Error`, the class every other shared-storage refusal is thrown as, so existing `catch` code keeps working and `.message` is still the server's text (`Too many submissions — retry in 312s`). A refusal without the metadata (an older host, or a refusal that is not a rate limit) is still a plain `Error`.

- `@civitai/app-sdk`: new type `SharedStorageRateLimit` on `./blocks`, and an optional `rateLimit?: SharedStorageRateLimit` on the six shared write replies (`SHARED_APPEND_RESULT`, `SHARED_UPDATE_RESULT`, `SHARED_VOTE_RESULT`, `SHARED_UNVOTE_RESULT`, `SHARED_WITHDRAW_RESULT`, `SHARED_REPORT_RESULT`).
- **Tolerant of a bad value.** No reply validator checks `rateLimit`, so it can never cause a reply to be dropped. The hook parses it: a malformed one (wrong types, a non-integer or a value below 1, a missing field, an unparseable `retryAt`, a non-object) is ignored and the refusal is thrown as a plain `Error`.
- **`dev:live`** forwards `error.data.rateLimit` from the tRPC refusal onto the bridge reply. It does not retry a shared-storage write: only POLL retries transient statuses, and a 429 on POLL is still retried.
- **Mock host:** new `shared.rateLimitNext` (refuse the next N writes as rate-limited) and `shared.rateLimit` (`{ retryAfterSeconds?, retryAt? }`, defaulting to 60 s from now), both settable through `setScenario`.
- README: a new "Shared-storage write limits" section under `useSharedStorage()` lists the per-(viewer, app) write limits, the refusal shape and how to handle the error.
