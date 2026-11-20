/**
 * The two — and only two — questions anyone asks about a `requestId`.
 *
 * Before #395 this file did not exist and both questions were open-coded at 64
 * sites in five different spellings. Measured on `e993cf0`:
 *
 * ```
 * 33 x  p.requestId !== undefined && typeof p.requestId !== 'string'   validate.ts
 *  1 x  !isNonEmptyString(p.requestId)                                 validate.ts
 * 26 x  typeof requestId !== 'string'                                  liveHost/mockHost
 *  2 x  typeof <expr>.requestId === 'string'                           iframeTransport.ts
 *  2 x  ...(requestId ? { requestId } : {})                            liveHost/mockHost
 * ```
 *
 * (The issue's "~45 sites" undercounts: it was written before #378/#416 moved
 * nine modules out of `internal/`, and it counted two TYPE ANNOTATIONS as if
 * they were predicates. The 64 above are runtime decisions only.)
 *
 * ⚠️ NOT ROUTED THROUGH HERE, DELIBERATELY: the 37 `requestId ?? ''`
 * expressions in `liveHost.ts`. They are nullish DEFAULTS on an EMIT path, not
 * routability decisions — nobody branches on the result; it is written straight
 * onto the wire. **MEASURED, not assumed: none of the 37 sits downstream of a
 * routability guard** (checked by walking back to each one's enclosing `case`),
 * so `liveHost` answers an id-less request with an unroutable `requestId: ''`
 * reply where `mockHost` declines to answer at all. Both end the same way — the
 * block cannot correlate either, and the request times out — and the arm is
 * unreachable in practice, because only `sendRequest` produces a request that
 * gets a reply and it always assigns an id (`nextRequestId()`); every `case`
 * reachable by the id-less `sendMessage` path returns before replying.
 *
 * Unifying those 37 onto an early `return` would be a 37-site behaviour change
 * on a dev-harness emit path, which is out of scope for a consolidation; they
 * are instead an ASSERTED COUNT in the guard, so a 38th cannot appear without
 * someone deciding. Filed as the follow-up in #395's PR, not fixed here.
 *
 * ## The two questions are NOT the same question, and collapsing them is a bug
 *
 * - **`isRoutableRequestId`** — "can this value correlate a reply to an entry in
 *   the transport's `pending` table?" A **non-empty string**. This is the
 *   decision every routing site makes.
 * - **`isWireRequestIdShape`** — "is the `requestId` field on this inbound
 *   payload well-formed?" **Absent, or any string — including `''`.** This is a
 *   trust-boundary *shape* check, and it is DELIBERATELY LOOSER than routability.
 *
 * 🔴 DO NOT "SIMPLIFY" THE VALIDATORS ONTO `isRoutableRequestId`. A validator
 * that returns `false` DROPS the whole message at the trust boundary, with
 * nothing but a `console.warn`. `isValidTokenRefreshResponse`'s docblock spells
 * out what that costs: a `TOKEN_REFRESH_RESPONSE` that cannot correlate still
 * carries a token that `handleMessage` applies to the snapshot regardless of
 * correlation, so dropping it converts a degraded path into a broken one. The
 * looseness is the back-compat story for a new SDK against a pre-v2 host, not an
 * oversight. Routability is decided LATER, by `isRoutableRequestId`, and an
 * unroutable-but-well-formed reply is delivered to push listeners rather than
 * discarded.
 *
 * The relationship is a strict containment and it is the whole contract:
 *
 * ```
 * isRoutableRequestId(v)  =>  isWireRequestIdShape(v)      (always)
 * isWireRequestIdShape(v) =/> isRoutableRequestId(v)       (v === undefined, v === '')
 * ```
 *
 * ## `null` is not routable, and never was
 *
 * #395 was filed on the theory that the spellings disagreed about
 * `requestId: null`. They do not — every one of the 64 sites above rejects
 * `null` (`typeof null === 'object'`; `null` is falsy; `null ?? ''` is `''`).
 * The two spellings the issue counted as differing on `null` were TYPE
 * ANNOTATIONS on the *payload* (`{ requestId?: unknown } | undefined` vs
 * `... | null | undefined`), not runtime predicates, and both sites runtime-guard
 * the payload anyway. `null` is therefore pinned here as the behaviour that
 * already held, not chosen: see `requestId.test.ts`.
 *
 * What the spellings DID disagree about is the EMPTY STRING — see
 * `isRoutableRequestId` below.
 *
 * Enforced by `tests/guards/blocks-react-requestid-routability.test.mjs`, which
 * fails when a routability or wire-shape decision is open-coded anywhere in
 * `packages/civitai-blocks-react/src` outside this module.
 */

/**
 * Can this value correlate a reply to a pending request?
 *
 * A **non-empty string**. Nothing else — not `null`, not `undefined`, not a
 * number a buggy host echoed, not `''`.
 *
 * 🔴 WHY NON-EMPTY, WHEN THREE OF THE FOUR OLD SPELLINGS ACCEPTED `''`.
 * `nextRequestId()` (transport.ts) returns `` `${base36}-${counter}` ``, which is
 * never empty, so `''` can never be a key in the transport's `pending` table:
 * `pending.get('')` was already a guaranteed miss at both routing sites. Making
 * the emptiness explicit costs nothing there and makes this predicate agree with
 * `isValidImageScanResolved`, the one site that already required non-empty. The
 * sites where it does move behaviour — the dev/mock hosts, which used to answer
 * a `requestId: ''` request with an equally unroutable `requestId: ''` reply, and
 * now decline to answer at all — are enumerated and pinned in `requestId.test.ts`.
 */
export function isRoutableRequestId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Is the OPTIONAL `requestId` field of an inbound payload well-formed?
 *
 * `true` when the field is absent (`undefined`) or is any string, `''` included.
 * `false` for every other type — a non-string cannot masquerade as a correlation
 * id, which is the only thing these validators need to rule out.
 *
 * Pass the FIELD, not the payload: `isWireRequestIdShape(p.requestId)`.
 *
 * Exactly equivalent to the 33 open-coded copies it replaced —
 * `!(v === undefined || typeof v === 'string')` is `v !== undefined &&
 * typeof v !== 'string'` — so no validator's behaviour moved. Read the module
 * docblock before tightening it.
 */
export function isWireRequestIdShape(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}
