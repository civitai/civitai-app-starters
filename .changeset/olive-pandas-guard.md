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

No currently-shipping host can trigger any of the above. Two earlier drafts of
this note got the *mechanism* wrong while reaching the right conclusion, so here
it is enumerated rather than characterised. Error strings on these reply types
come from at least **five** distinct sources across the two hosts:

1. `storageErrorMessage()` — guards `message.length > 0`, else the constant
   `'storage request failed'`;
2. `REVIEW_NACK_MESSAGE` — a non-empty constant, reaching **eleven of the
   seventeen** reply types (seven of the eleven this PR fixes), bypassing
   `storageErrorMessage()` entirely;
3. the bare `err instanceof Error ? err.message : 'unknown'` path — the one
   source that CAN yield `''`, see below;
4. bare non-empty literals on `SAVE_IMAGE_RESULT` (`'busy'`,
   `'image is not available'`, …);
5. bare non-empty literals on `USER_CHECKPOINT_SET`.

Every source but (3) is non-empty by construction, so the conclusion holds for
the eleven sites this PR fixes. **Do not read the list as closed** — it is what
an enumeration at `civitai@94a564a` found, and the honest claim is "these five,
checked", not "these are all there can be".

🔴 **One reply type in the seventeen IS fed by source (3).**
`IframeHost.tsx` emits `USER_CHECKPOINT_SET` with
`err instanceof Error ? err.message : 'unknown'`, and `err.message` is `''` for
`new Error()`. That site is safe only because PR #273 already moved
`useCheckpointPicker.persist` to presence — i.e. the guard is load-bearing
there today, not prophylactic.

(Separately, and untouched here: the other non-storage reply types use
`error ?? fallback`. `??` does not replace `''`, so they can raise an Error with
an EMPTY message. They still reject, via a `|| !result.<field>` clause.)

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
