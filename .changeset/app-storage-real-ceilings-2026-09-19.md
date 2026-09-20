---
'@civitai/app-sdk': minor
'@civitai/blocks-react': patch
---

App Storage: the real ceilings, written once, and the mock now ENFORCES the row limit

Every documented and simulated source of truth in this repo put the App Storage
quota **25x too high on bytes and 1000x too high on rows**. Worse, the mock
host's *defaults* carried those figures, so a block that exceeded the real limit
ran perfectly under `dev:mock` and failed only in production.

## The numbers, confirmed

The audit that found this could not verify the host's figures from this
repository. They are now confirmed, from `civitai/civitai` `main` on 2026-09-19
via `gh api` (not a local checkout), `src/server/routers/apps.router.ts`, blob
`654f2d6`:

```ts
const PER_VALUE_BYTE_CAP = 64 * 1024;       // :172
const USER_QUOTA_BYTES   = 2 * 1024 * 1024; // :204
const USER_ROW_LIMIT     = 1_000;           // :205
```

and `getQuota` returns `limitBytes: USER_QUOTA_BYTES, limitRows: USER_ROW_LIMIT`
— so those are exactly the numbers a block reads back.

**What the old docs were quoting.** The host has a second, app-wide pair
(`APP_QUOTA_BYTES` / `APP_ROW_LIMIT`) sitting above the per-viewer clamp; the
repo's figures were those. They are real, but nothing reports an app's usage
against them and the per-viewer clamp binds long first.

## Scope: the namespace and the budget are different

The docs said "(block instance, user)" and then quoted a per-**app** ceiling.
Both halves were describing something real, which is why the contradiction went
unnoticed:

- **Namespace** — rows are keyed `(block_instance_id, user_id, key)`. "Per
  (block instance, viewer)" is correct and unchanged.
- **Budget** — the host's quota counter is keyed `(app_block_id, user_id)`, so
  the byte and row budgets are per **(app, viewer)**: every instance of one app
  shares one budget for that viewer.

## Written once

New: `APP_STORAGE_MAX_VALUE_BYTES`, `APP_STORAGE_MAX_BYTES` and
`APP_STORAGE_MAX_ROWS`, exported from `@civitai/app-sdk/blocks`. Their
definition file is the only place the figures appear in this repo and carries
their provenance plus the `gh api` one-liner that re-derives them. Nine files
(the SDK message contract, `useAppStorage`, both dev hosts, two READMEs, the
`kv-storage` example and its harness, and a test) now reference the constants —
29 hand-copied literals removed.

The app-wide umbrella is deliberately **not** exported and its value
deliberately not written down: nothing reports usage against it, so a constant
for it could only be used to build a UI that lies.

## The mock now fails where production fails

`createMockHost`'s storage defaults ARE the production ceilings, and — the part
that turns a docs bug into a shipped-block bug — the write path now **enforces
the row limit**. It was reported by `getQuota` and enforced by nothing, so the
ceiling a block reaches *first* was invisible to `dev:mock`. The same gap
existed in the `kv-storage` example's own harness and is fixed there too.

The gate is `isInsert`-guarded, matching the host: a store sitting at the
ceiling must still accept an **overwrite**, or an app whose UI has no delete
affordance would be permanently stuck with no way back under the cap (only the
owning viewer may delete their own rows).

## Not changed: the error code

The issue proposed splitting `PAYLOAD_TOO_LARGE` into a distinct
`ROW_LIMIT_EXCEEDED`. Declined, and the reason is measured: the host returns
`PAYLOAD_TOO_LARGE` for **all five** rejection sites. Inventing a code
production never emits would make the mock diverge from the host in exactly the
direction this change exists to close. The docs now say instead that a
rejection does **not** imply the value was too big — the row ceiling has nothing
to do with the size of the value being written.

(Separately measured while confirming the above: the host bridge forwards the
TRPCError's *message*, not its code, so a block actually receives strings like
`per-user row limit exceeded`. Our docs and mock both say `PAYLOAD_TOO_LARGE`.
That is a real divergence, it is a different defect from this one, and it is
filed rather than batched here.)
