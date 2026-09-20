---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
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
definition file is the only place any **runtime or documentation** site spells
the figures, and it carries their provenance plus the `gh api` one-liner that
re-derives them. (Not literally the only place in the repo: this changeset, the
guard that enforces the rule, and future CHANGELOGs all quote them, as history
and as test data must.) Nine files
(the SDK message contract, `useAppStorage`, both dev hosts, two READMEs, the
`kv-storage` example and its harness, and a test) now reference the constants —
29 hand-copied literals removed.

The app-wide umbrella is deliberately **not** exported and its value
deliberately not written down: nothing reports usage against it, so a constant
for it could only be used to build a UI that lies.

## The mock now fails on the row limit, where it used to pass

`createMockHost`'s storage defaults ARE the production ceilings, and — the part
that turns a docs bug into a shipped-block bug — the write path now **enforces
the row limit**. It was reported by `getQuota` and enforced by nothing, so the
ceiling a block reaches *first* was invisible to `dev:mock`. The same gap
existed in the `kv-storage` example's own harness and is fixed there too.

The gate is `isInsert`-guarded, matching the host: a store sitting at the
ceiling must still accept an **overwrite**, or an app whose UI has no delete
affordance would be permanently stuck with no way back under the cap (only the
owning viewer may delete their own rows).

This closes one gap; it does not make the mock gate-for-gate identical to the
host, and the docs no longer claim it is. **Three** divergences are known and
filed:

- the error string a rejection carries (#343);
- the byte gate's SHAPE — the host's is `!isNonIncreasing`-guarded, the mock's
  is not, so `dev:mock` still refuses a shrinking overwrite production admits
  (#345);
- the byte gate's UNIT — the mock counts **wire** bytes
  (`TextEncoder(JSON.stringify(v)).length`), the host counts **stored** bytes
  (`octet_length(value::jsonb::text)`), which is larger for every container
  because `jsonb`'s canonical text inserts a space after each `:` and `,` (up
  to ~1.4999x for a long array). So the mock's budget is up to half again too
  generous (#347).

🔴 **The third one runs the other way.** #343 and #345 are RESTRICTIVE — the
mock shows a failure or a wrong string where production would be fine. #347 is
**permissive**: a block can pass `dev:mock` and be rejected in production. That
is the shape of the very bug this release exists to end, so it is called out
rather than batched — and the unit fact behind it is one this diff already
relies on, in `mockHost.ts`'s reason for not fixing #345. The conclusion had
simply never been drawn for the budget gate.

## The `@civitai/blocks-react` peer floor moves 0.45.0 → 0.47.0

`internal/mockHost.ts` now VALUE-imports `APP_STORAGE_MAX_BYTES`,
`APP_STORAGE_MAX_ROWS` and `APP_STORAGE_MAX_VALUE_BYTES`, which first ship in
the `@civitai/app-sdk` minor this changeset publishes. Left at `>=0.45.0`, the
range admitted the published `0.46.0` — which has none of them — with no peer
warning at all, and `@civitai/blocks-react/testing` then died at module
evaluation:

```
SyntaxError: The requested module '@civitai/app-sdk/blocks'
  does not provide an export named 'APP_STORAGE_MAX_BYTES'
```

Measured against the real tarballs: the main entry still resolves (61 exports),
so the failure lands on every dev harness and downstream test suite rather than
on the block. This is the third time the class has come up (#309, #317), so the
floor's derivation — `changeset status --verbose` on this branch, plus the
measurement in both directions — is recorded in the package's
`comment-peerDependencies`, and `tests/guards/blocks-react-peer-floor.test.mjs`
now fails when the declared range admits an app-sdk version that lacks the
constants. Note `changeset version` cannot fix this: with
`onlyUpdatePeerDependentsWhenOutOfRange` a floor that is too LOW is still
satisfied, so it is left alone and ships stale.

## 🔴 BREAKING FOR CONSUMERS OF `@civitai/blocks-react/testing` — a `minor`, not a `patch`

`createMockHost` is published. This changes its **defaults** and adds a
**rejection** to its write path, so a downstream block's existing test suite can
go green → red with no change on its side:

- `storage.limitRows` defaults from **1,000,000 to 1,000**, and is now enforced.
  A test that seeds or writes more than 1,000 distinct keys now gets
  `{ ok: false }` on the 1,001st INSERT where it previously got `{ ok: true }`.
- `storage.quotaBytes` defaults from **50 MB to the per-viewer clamp** (25x
  smaller). A fixture holding more than the clamp now trips the byte gate.
- A snapshot or assertion that pins `getQuota()`'s `limitBytes` / `limitRows`
  against the old defaults now reads different numbers.

**That is the intended behaviour** — every one of those suites was green against
a simulation 1000x more permissive than production, which is precisely the
failure this release exists to end. But it is a behaviour change to a published
API's observable output, so it ships as a `minor` rather than a `patch`.

**To restore the old behaviour in a test that needs it** (e.g. a deliberate
high-volume fixture), pass the ceiling explicitly:
`createMockHost({ storage: { limitRows: 1_000_000, quotaBytes: 50 * 1024 * 1024 } })`.
Prefer fixing the fixture: if the block really writes that many rows, it will
fail in production too.

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
filed as #343 rather than batched here. The contract comment and the mock's
docs now scope the "you cannot tell which ceiling tripped" statement to the
MOCK and point at #343, so nobody writes a single generic retry arm on the
strength of a claim we have already measured to be false of the host.)
