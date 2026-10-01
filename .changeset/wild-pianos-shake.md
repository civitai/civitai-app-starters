---
'@civitai/blocks-react': minor
---

Consent prompt-and-retry is now the DEFAULT on every consent-gated WRITE.

A block that calls a capability whose consent-gated scope its token was minted
without used to get a failure and nothing else; the app author had to write the
prompt-then-retry dance by hand, and almost nobody did — so working apps looked
broken. `submit()`, `createPost()`, `purchase()` and `tip()` now open the host's
consent dialog naming the scope the call needs, wait for the grant, and retry
the original call ONCE so it resolves as if it had just worked.

🔴 **BREAKING — this is a behaviour change existing callers will notice.** A
call that used to reject immediately can now stay
pending for up to 60 s while the viewer answers a dialog your app did not open,
and then succeed. Three test suites in this repo had to be given already-granted
scopes because the new default absorbed the failures they were deliberately
provoking (`test/mockHostScenarios.test.tsx`,
`test/mockHostCustomComfy.test.tsx`, `test/useBuzzWorkflow.test.tsx`) — that is
the same surprise an app's own tests will hit. `autoRequestConsent: false`
restores the old behaviour per call.

⚠️ **Released as a MINOR, deliberately — the 1.0 declaration is deferred.** This
entry asked for a `major` when it was written; that was reversed before release.
The reasoning it recorded is what makes the reversal safe, so it is kept rather
than deleted: under 0.x semver a `minor` already breaks a `^0.60.0` consumer, and
`^0.60.0` resolves to `>=0.60.0 <0.61.0`, so **`0.61.0` and `1.0.0` are equally
out of range** — a caret-ranged consumer does not receive this change
automatically under either number, and gains no protection from the major. What a
major would have bought is a louder signal in the version itself, which is not
worth a one-way door; the signal lives in this entry's own 🔴 BREAKING line
instead. (`starters/civitai-block-starter`'s `^0.60.0` pin is rewritten by the
`chore(release): version packages` flow either way, so `check:starter-pins` is
not left red by the bump.)

🔴 **The retry re-sends the FIRST attempt's `idempotencyKey`** — the money-safety
property, since a retry with a fresh key is a SECOND reservation against the
viewer's Buzz. `submit()`, `purchase()` and `tip()` mint the key once, above the
retry, and hand the same value to both attempts. Pinned on the literal wire
values in `test/withConsentRetry.test.tsx` and mutation-checked: minting the key
inside the retried closure kills 2 tests on the bridge rail (`submit()`) and 3 on
the direct-fetch rail (`tip()`), each on a literal key-equality assertion.

**`estimate()` is deliberately NOT routed.** It is a price read that blocks call
from an effect keyed on the generation form, so it fires on mount and on every
parameter change; prompting there would open a consent dialog with no user
gesture behind it, once per edit. It keeps its old signature and its old
rejection behaviour.

It retries at most ONCE, never loops, and never retries at all when: the token
already holds every scope the call needs (so every non-consent failure behaves
exactly as before); the call failed BEFORE `BLOCK_INIT` landed, where there is no
real token and so no fact about consent to read; the host has pushed
`CONSENT_UNAVAILABLE` naming a scope THIS call needs; the viewer dismissed a host
confirm (`declined`); there is no session at all (`signInRequired` — that routes
to `useRequestSignIn()`); the component unmounted, INCLUDING during the 60 s
wait; or the request timed out on a bridge with NO idempotency key
(`createPost()`, collection follow), where a re-send would be a genuine second
write rather than a replay. A timeout on a call that HAS a key is retried — same
key, one operation. A viewer who never answers the dialog gets the ORIGINAL error
back after 60 s.

**Concurrent callers share one dialog.** Calls in flight together that need the
same scope post ONE `REQUEST_CONSENT` and wait on it together, so a feed of tip
buttons does not open a dialog per button. Each call still retries its own
request with its own idempotency key, so N tips stay N transfers. This covers
CONCURRENT waits only — sequential calls each get their own prompt, which is part
of why `estimate()` stays out.

New exported type `ConsentRetryOptions` (one field, `autoRequestConsent`) —
accepted by every routed call above, on by default, opt out per call.
`createPost()` takes a new optional trailing `options` argument.

Also: `createMockHost`'s consent grant now returns the scopes the block ASKED
for (filtered to the known vocabulary) instead of only `ai:write:budgeted`, so a
`posts:write:self` grant is reachable in `pnpm dev` — it was not, which made this
feature unexercisable locally for every hook but the workflow one. A grant asked
for by name no longer also hands out `ai:write:budgeted` and `buzzBudget`, so the
PARTIAL-grant case is reachable too; a `REQUEST_CONSENT` with no usable scopes
hint still grants the budgeted scope, as before.
