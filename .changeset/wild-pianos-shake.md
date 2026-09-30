---
'@civitai/blocks-react': major
---

Consent prompt-and-retry is now the DEFAULT on every consent-gated WRITE.

A block that calls a capability whose consent-gated scope its token was minted
without used to get a failure and nothing else; the app author had to write the
prompt-then-retry dance by hand, and almost nobody did — so working apps looked
broken. `submit()`, `createPost()`, `purchase()` and `tip()` now open the host's
consent dialog naming the scope the call needs, wait for the grant, and retry
the original call ONCE so it resolves as if it had just worked.

🔴 **BREAKING — this is a behaviour change existing callers will notice**, which
is why it is a major. A call that used to reject immediately can now stay
pending for up to 60 s while the viewer answers a dialog your app did not open,
and then succeed. Three test suites in this repo had to be given already-granted
scopes because the new default absorbed the failures they were deliberately
provoking (`test/mockHostScenarios.test.tsx`,
`test/mockHostCustomComfy.test.tsx`, `test/useBuzzWorkflow.test.tsx`) — that is
the same surprise an app's own tests will hit. `autoRequestConsent: false`
restores the old behaviour per call.

🔴 **The retry re-sends the FIRST attempt's `idempotencyKey`** — the money-safety
property, since a retry with a fresh key is a SECOND reservation against the
viewer's Buzz. `submit()`, `purchase()` and `tip()` mint the key once, above the
retry, and hand the same value to both attempts. Pinned on the literal wire
values in `test/withConsentRetry.test.tsx`, and that test is the only one in the
file that kills a "the retry mints a fresh key" mutant.

**`estimate()` is deliberately NOT routed.** It is a price read that blocks call
from an effect keyed on the generation form, so it fires on mount and on every
parameter change; prompting there would open a consent dialog with no user
gesture behind it, once per edit. It keeps its old signature and its old
rejection behaviour.

It retries at most ONCE, never loops, and never retries at all when: the token
already holds every scope the call needs (so every non-consent failure behaves
exactly as before); the host has pushed `CONSENT_UNAVAILABLE` for this
environment; the viewer dismissed a host confirm (`declined`); the component
unmounted mid-request; or the request timed out on a bridge with NO idempotency
key. A timeout on a call that HAS a key is retried — same key, one operation.
A viewer who never answers the dialog gets the ORIGINAL error back after 60s.

New exported type `ConsentRetryOptions` (one field, `autoRequestConsent`) —
accepted by every routed call above, on by default, opt out per call.
`createPost()` takes a new optional trailing `options` argument.

Also: `createMockHost`'s consent grant now returns the scopes the block ASKED
for (filtered to the known vocabulary) instead of only `ai:write:budgeted`, so a
`posts:write:self` grant is reachable in `pnpm dev` — it was not, which made this
feature unexercisable locally for every hook but the workflow one.
