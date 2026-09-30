---
'@civitai/blocks-react': minor
---

Consent prompt-and-retry is now the DEFAULT on every consent-gated call.

A block that calls a capability whose consent-gated scope its token was minted
without used to get a failure and nothing else; the app author had to write the
prompt-then-retry dance by hand, and almost nobody did — so working apps looked
broken. `estimate()`, `submit()`, `createPost()`, `purchase()` and `tip()` now
open the host's consent dialog naming the scope the call needs, wait for the
grant, and retry the original call ONCE so it resolves as if it had just worked.

🔴 **The retry re-sends the FIRST attempt's `idempotencyKey`** — the money-safety
property, since a retry with a fresh key is a SECOND reservation against the
viewer's Buzz. `submit()`, `purchase()` and `tip()` mint the key once, above the
retry, and hand the same value to both attempts. Pinned on the literal wire
values in `test/withConsentRetry.test.tsx`, and that test is the only one in the
file that kills a "the retry mints a fresh key" mutant.

It retries at most ONCE, never loops, and never retries at all when: the token
already holds every scope the call needs (so every non-consent failure behaves
exactly as before); the host has pushed `CONSENT_UNAVAILABLE` for this
environment; the viewer dismissed a host confirm (`declined`); or the request was
aborted / timed out on a bridge with no idempotency key. A viewer who never
answers the dialog gets the ORIGINAL error back after 60s.

New exported type `ConsentRetryOptions` (`autoRequestConsent`, `consentTimeoutMs`)
— accepted by every call above, on by default, opt out per call. `estimate()` and
`createPost()` take a new optional trailing `options` argument.

Also: `createMockHost`'s consent grant now returns the scopes the block ASKED
for (filtered to the known vocabulary) instead of only `ai:write:budgeted`, so a
`posts:write:self` grant is reachable in `pnpm dev` — it was not, which made this
feature unexercisable locally for every hook but the workflow one.
