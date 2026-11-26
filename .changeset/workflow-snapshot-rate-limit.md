---
'@civitai/app-sdk': minor
'@civitai/sdk': minor
---

**A workflow snapshot can carry the rate limit that refused it: `BlockWorkflowSnapshot.rateLimit`.** Additive and optional.

civitai.com now attaches `rateLimit` to a workflow refusal: the `failed` snapshot of an estimate, submit or cancel the limit turned away, and the `throttled` reply of a poll or cancel that a limit shed. It is the same retry metadata every other bridge error reply already carries: which limit, when to retry (`retryAfterSeconds`, `retryAt`) and, for a limit that publishes them, its counts.

- `@civitai/app-sdk/blocks` adds `BlockWorkflowSnapshot.rateLimit?: RateLimitMeta` and exports the `RateLimitMeta` type.
- `@civitai/sdk` picks up the same field through its generated copy of the workflow types. The root `RateLimitMeta` export is now that copy, which has the same shape as `BridgeError.rateLimit`.
- `@civitai/sdk`'s `ApiError` gains `rateLimit?: RateLimitMeta`, parsed from a `429` body's `rateLimit`. This covers a REST workflow call refused with a `429`.

The field is absent on a host that predates it and on every snapshot that was not refused, so nothing changes for code that does not read it.
