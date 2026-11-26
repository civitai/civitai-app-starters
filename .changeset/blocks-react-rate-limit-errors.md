---
'@civitai/blocks-react': minor
---

**A hook that throws for a rate-limited call now carries the limit on the error: `rateLimitOf(err)`.** Additive: every error keeps its class, `name` and `message`.

The host's `rateLimit` retry metadata (which limit, when to retry and, for a limit that publishes them, its counts) used to be dropped when a hook turned a refused reply into an exception. It is now kept:

- **New `rateLimitOf(err)`** returns the `RateLimitMeta` on any error a hook threw or set as its `error`, or `undefined`. It reads `err.rateLimit`, so it also works on `@civitai/sdk`'s `BridgeError`.
- **The workflow errors declare it.** `WorkflowEstimateError`, `WorkflowSubmitError`, `WorkflowCancelNotIssuedError` and `BatchEstimateError` gain `rateLimit?: RateLimitMeta`. For the first three it is copied from the snapshot's `rateLimit`; for `BatchEstimateError` it comes from the whole-call error reply.
- **Every other hook keeps it too.** The plain `Error`s and per-hook error classes that the bridge hooks throw or set from an error reply now carry the reply's `rateLimit` as an own property. Read it with `rateLimitOf(err)`.
- **Workflow snapshots are validated.** A malformed `snapshot.rateLimit` is removed and the rest of the snapshot is delivered. A valid one keeps only its known fields.
- The `RateLimitMeta` type is re-exported from `@civitai/app-sdk/blocks` as a type only, so the `@civitai/app-sdk` peer floor is unchanged.

On a host that sends no `rateLimit`, the errors are exactly what they were before and have no `rateLimit` property at all.
