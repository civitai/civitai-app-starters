---
'@civitai/blocks-react': patch
---

fix(blocks-react): treat a PRESENT `error` as the reject signal at the eleven remaining `{ok, error}` hook sites, and single-source the predicate

PR #273 fixed six sites; eleven kept testing `error` for TRUTHINESS, so the two
spellings sat side by side in one file for a release. `error: ''` is falsy but
PRESENT — the reply validator early-accepts it and therefore SKIPS the
success-field checks, so a truthiness test sails past into a field the validator
never verified.

The wire types hide this from `tsc`: `SHARED_LIST_RESULT.items` is typed
REQUIRED while `error` is optional, so `result.items.map(...)` compiles and then
throws at runtime.

## Sites

`useSharedStorage`: `list`, `get`, `getCount`, `getCounts`, `append`, `vote`,
`unvote`, `withdraw`. `useAppStorage`: `get`, `list`, `getQuota`.

What each did at the base commit on `{ requestId, error: '' }`:

| outcome | sites |
| --- | --- |
| threw a raw `TypeError` (deref of a missing field) | `list` (both hooks) |
| resolved `undefined` typed `number`/`string` | `getCount`, `getCounts`, `append`, `vote`, `unvote`, `getQuota` |
| resolved `null` — indistinguishable from "no such key" | `get` (both hooks) |

## Reachability — this is PROPHYLACTIC, not a live bug fix

Both shipping hosts build every `SHARED_*` / `APP_STORAGE_*` error through
`storageErrorMessage()`, which guards `message.length > 0` and otherwise returns
the constant `'storage request failed'`. **It cannot return `''`**, so no
currently-shipping host can trigger any of the above. The change closes the
contract, it does not repair an observed failure.

(Separately: the NON-storage reply types are built from a bare
`err instanceof Error ? err.message : 'unknown'`, and `err.message` IS `''` for
`new Error()`. Those hooks pair truthiness with a `|| !result.<field>` clause so
they still reject — but they use `error ?? fallback`, and `??` does not replace
`''`, so they can raise an Error with an EMPTY message. Untouched here.)

## Single-sourcing

The predicate moved to `internal/replyError.ts` (`throwOnReplyError`,
`throwOnFailedReply`) and all sites now call it, including the six #273 already
fixed. A predicate open-coded at N sites is typically wrong at N-1 of them in the
same direction; this is what makes a future divergence one edit instead of
seventeen. The helpers are internal — no export surface changes, hence `patch`.

## One guard lost its reachability, and is now labelled instead of faked

`withdraw()`'s `typeof result.deleted !== 'boolean'` narrowing was previously
reached by a test sending `{ ok: true, error: '', deleted: 'yes' }` — but ONLY
because the site tested truthiness. With presence, that fixture rejects on
`error` first. The only other route is a non-boolean `deleted` with NO error,
and `isValidSharedWithdrawResult` DROPS that before the hook sees it (measured:
written as a reject assertion, it timed out at 5 s because the reply never
settles). The test now asserts the DROP, and the narrowing is documented as
defence-in-depth with no transport-reachable killing test — rather than keeping
an assertion that can no longer execute.
