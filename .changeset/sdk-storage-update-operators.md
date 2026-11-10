---
'@civitai/sdk': minor
---

Document storage: counters and marks as update operators (civitai/civitai#8292).

- New `collection.update(key, op)` sends ONE operator as `PATCH /api/v1/blocks/storage/:collection/:key`: `{ $inc: { [counter]: by } }` resolves `{ value }`, `{ $mark: name }` resolves `{ marked: true, count? }` and `{ $unmark: name }` resolves `{ marked: false, count? }`. `by` is required (no default on the wire). A second operator, an unknown operator, a mark name that is not a string and a `by` that is not a number are type errors. A body the server cannot read as one operator is refused `invalid_request` with `details.reason` (`empty_patch`, `unknown_operator`, `multiple_operators`, `merge_patch_unsupported` or `malformed_operator`). New types: `StorageUpdateOp`, `StorageIncrementOp`, `StorageMarkOp`, `StorageUnmarkOp`.
- `increment`, `mark` and `unmark` are `@deprecated` in favour of `update`, and otherwise unchanged: same signatures, replies, routes and request shapes.
- `createFakeStorage` (and so the dev-tunnel local preview) serves the PATCH route with the server's validation, check order, messages and reasons. The vendored storage contract is re-vendored from civitai/civitai main, with its two PATCH cases.

Only `update` needs a civitai.com that serves the PATCH route (civitai/civitai#8292). An app that upgrades before civitai.com serves it loses only `update` (refused `method_not_allowed`, 405, or, from a block's cross-origin frame, a CORS preflight that does not allow PATCH); `increment`, `mark` and `unmark` keep working.
