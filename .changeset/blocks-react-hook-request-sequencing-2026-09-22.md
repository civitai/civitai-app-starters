---
'@civitai/blocks-react': minor
---

Give every auto-fetching hook a latest-wins request guard, settle `useImageUpload`'s pending scan promises on unmount, and stop `useTipAllowance` spinning forever without a host origin (#392, #393, #398).

**#392 — a slow earlier reply could overwrite newer state, in EIGHT hooks.**
`useAppWorkflows`, `useBuzzAccounts`, `useBuzzBalance`, `useBuzzTransactions`,
`useDailyCompensation`, `useTipAllowance`, `useViewer` and `useWildcardPack` each
guarded only *unmount*. Nothing correlated a reply with the request that produced
it, so an out-of-order resolution silently won. The concrete shape: a `params`
change (the viewer clicks "next page") changes `refetch`'s identity, the mount
effect re-runs, and request B goes out while A is still in flight — B paints page
2, then A lands and repaints page 1 **and** rewinds `cursor` to page 2's value,
so "next" re-fetches the page already on screen and the viewer is wedged. The
transport correlated each reply to its own request correctly throughout; the
defect was purely in which reply the hooks let write state.

All eight now share ONE guard, `useRequestSequencer`, rather than eight copies of
a predicate that was wrong in the same direction at all eight sites. It supersedes
`mountedRef` instead of sitting beside it: `isCurrent(token)` is false for a
superseded request AND after unmount.

🔴 **The issue filed this as SEVEN hooks**, excluding `useTipAllowance` because
its `inFlight: Set<AbortController>` was read as already sequencing. It is not:
that set is drained only by the unmount cleanup, so two overlapping `refetch()`es
neither abort each other nor correlate their replies. It is in the fixed set, and
the regression test for it fails on the previous release exactly like the other
seven.

**#393 — `useImageUpload`'s pending `scanStatus()` promise never settled on
unmount.** The cleanup cleared each waiter's backstop timer and stopped there,
which removed the only remaining path to a settled promise: the verdict listener
was gone, so nothing could arrive, and the timeout that would have resolved it had
just been cancelled. An `await scanStatus(handle)` in flight at unmount hung for
the life of the page. Unmount now RESOLVES every waiter with the hook's existing
retryable shape — `{ status: 'error', message: 'scan status unavailable (the
upload hook unmounted)' }` — never a rejection, so no caller needs a new
`try`/`catch`. The tracking map is dropped too, so a `scanStatus()` call made
after unmount takes the immediate unknown-handle path instead of arming a
ten-minute wait against a listener that no longer exists.

**#398 — `useTipAllowance` spun forever with no error when the host origin never
arrived.** `loading` initialises `true` and `refetch` bailed on `!host` before
touching it, so on any surface where `BLOCK_INIT` never lands (a direct or
unembedded load, `InlineTransport` before bootstrap) the documented
`if (loading) return <Spinner/>` pattern rendered forever with no diagnostic. The
hook now waits a bounded 30s — the origin is absent during every healthy boot too,
so an immediate error would flash on every embedded block — and then settles to
`loading: false` with a named `Error`. The sibling divergence the issue flagged is
deliberate and kept: `useTip` and `useGenerationResources` are imperative (the
caller holds a promise) so they reject immediately with their own named errors;
`useWildcardPack`'s early `setLoading(false)` is a `modelVersionId` validity guard
and that hook never reads the host origin at all.

**Why `minor`, not `patch`:** two of the three change what a CORRECT consumer
observes, not just what a broken one does. A `scanStatus()` promise that used to
hang now resolves with an `'error'` verdict, so code awaiting it proceeds where it
previously stopped; and `useTipAllowance` now surfaces an `error` where an
un-embedded block previously stayed `loading: true`, so a consumer branching on
`error` renders an error state where it used to render a spinner. The #392 half
alone would be a patch.
