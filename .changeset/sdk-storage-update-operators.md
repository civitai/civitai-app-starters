---
'@civitai/sdk': minor
---

Document storage: counters and marks are update operators (civitai/civitai#8292).

- New `collection.update(key, op)` sends ONE operator as `PATCH /api/v1/blocks/storage/:collection/:key`: `{ $inc: { [counter]: by } }` resolves `{ value }`, `{ $mark: name }` resolves `{ marked: true, count? }` and `{ $unmark: name }` resolves `{ marked: false, count? }`. `by` is required (no default on the wire). A second operator, an unknown operator, a mark name that is not a string and a `by` that is not a number are type errors. New types: `StorageUpdateOp`, `StorageIncrementOp`, `StorageMarkOp`, `StorageUnmarkOp`.
- `increment`, `mark` and `unmark` are `@deprecated` in favour of `update`. Their signatures and replies are unchanged (`increment`'s `by` still defaults to 1, now in the client), and they send the same PATCH, so they no longer call the deprecated per-tally routes. A counter or mark name now travels in the body, so `''`, `.` and `..` are sent and refused by the server (`invalid_request`, 400) instead of before sending.
- `storageUpdateRefusal(error)` and `StorageUpdateRefusalReason` read the `details.reason` of a refused PATCH body: `empty_patch`, `unknown_operator`, `multiple_operators`, `merge_patch_unsupported` or `malformed_operator`.
- `createFakeStorage` (and so the dev-tunnel local preview) serves the PATCH route with the server's validation, check order, messages and reasons. The vendored storage contract is re-vendored from civitai/civitai main, with its two PATCH cases.

Needs a civitai.com that serves the PATCH route. Against one that does not, `update` and the three deprecated methods fail: `method_not_allowed` (405), or, from a block's cross-origin frame, a CORS preflight that does not allow PATCH (a fetch `TypeError`).
