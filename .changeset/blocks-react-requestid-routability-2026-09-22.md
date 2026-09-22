---
'@civitai/blocks-react': patch
---

One predicate decides `requestId` routability, in one place (#395).

**`patch`, and the reasoning is the interesting part.** Nothing is added to or
removed from the published surface — `isRoutableRequestId` / `isWireRequestIdShape`
live in `src/transport/requestId.ts` and are deliberately NOT re-exported from the
entry. Every validator behaves exactly as before. Two behaviours *did* move, and
both are on values the SDK itself cannot produce (`sendRequest` always assigns a
non-empty id from `nextRequestId()`), reachable only by a hand-built message or a
buggy peer:

- **The dev/mock hosts now decline a request carrying `requestId: ''`** instead of
  answering it with an equally uncorrelatable `requestId: ''` reply. The block's
  end state is unchanged — that reply never settled anything and the request timed
  out either way — so this removes an unroutable message from the wire rather than
  changing an outcome.
- **A non-string `requestId` is no longer echoed onto `TOKEN_REFRESH_RESPONSE`.**
  The old `...(requestId ? { requestId } : {})` was a *truthiness* test, so a
  numeric id was spread straight back — and then failed the block's own
  `isValidTokenRefreshResponse`, dropping the whole message *including the token
  update it exists to deliver*. The field is now omitted and the message validates.
  This is strictly a repair.

Because the second bullet is a repair on a malformed-input path and the first is
observable only through `createMockHost`, this is not a behaviour consumers can be
relying on. Both are pinned by tests that are **red against the previous host
sources and green here**.

## What was actually wrong

"A reply with no `requestId` is unroutable" was stated in prose and open-coded at
**64 sites in five spellings**, measured on `e993cf0`:

```
33 x  p.requestId !== undefined && typeof p.requestId !== 'string'   validate.ts
 1 x  !isNonEmptyString(p.requestId)                                 validate.ts
26 x  typeof requestId !== 'string'                                  liveHost/mockHost
 2 x  typeof <expr>.requestId === 'string'                           iframeTransport.ts
 2 x  ...(requestId ? { requestId } : {})                            liveHost/mockHost
```

#395 was filed on the theory that these disagreed about `null`. **They did not** —
every one of the 64 rejects `null`. The two spellings the issue counted as
differing on `null` were TYPE ANNOTATIONS on the *payload*
(`{ requestId?: unknown } | undefined` vs `… | null | undefined`), not runtime
predicates, and both of those sites runtime-guard the payload anyway. What they
genuinely disagreed about is the **empty string**: three spellings accepted `''`
as a correlation id, one (`isValidImageScanResolved`) required non-empty, and the
two truthiness spreads dropped it.

## The two questions, kept apart on purpose

Collapsing them would have been the real regression:

- `isRoutableRequestId` — "can this correlate a reply to a pending request?"
  **Non-empty string.** `''` can never be a key in the `pending` table, so this is
  free at both routing sites and now agrees with the one validator that already
  said so.
- `isWireRequestIdShape` — "is the field well-formed on the wire?" **Absent, or any
  string, `''` included.** Deliberately looser: a validator returning `false` drops
  the whole message at the trust boundary, and
  `isValidTokenRefreshResponse`'s docblock spells out what that costs against a
  pre-v2 host. Routability is decided later, and an unroutable-but-well-formed
  reply is delivered to push listeners rather than discarded.

`isRoutableRequestId(v) ⇒ isWireRequestIdShape(v)`, strictly — `''` and `undefined`
sit in the gap, and a test asserts exactly those two are in it.

Enforced by `tests/guards/blocks-react-requestid-routability.test.mjs`, which
detects the decision **shape** rather than a spelling (a `typeof` before the
operand, a comparison / logical / ternary operator beside it, a boolean coercion
around it) and names in its own docblock what it cannot see — chiefly an aliased
local, which has a test of its own pinning the hole as a hole.
