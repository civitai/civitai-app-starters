---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

`BLOCK_INIT` v2 — type the slot context, require the token-reply's `requestId`,
and begin retiring the init-time identity + build-time-identity fields.

Four changes from a platform review of the init contract. Two tighten types with
no wire change; two are **deprecations that deliberately do NOT change the wire**,
for a reason worth reading before "finishing" them.

**1. `BlockContext` is a discriminated union keyed on `slotId`.**
It was `{ slotId: string; [key: string]: unknown }`. An untyped index signature
in a public third-party contract types every misspelling as a legal `unknown`
read and makes any field a producer happens to set look readable, whether or not
the host forwards it. It is now
`ModelSlotContext | PageSlotContext | UnknownSlotContext`, with
`isModelSlotContext()` / `isPageSlotContext()` to narrow — real runtime checks,
since the value crossed a `postMessage` boundary. `UnknownSlotContext` keeps the
union open to slots a future host registers, and carries `slotId` only, so
reading anything off it is an explicit cast rather than an accidental read.

Two things fall out of writing the members honestly:

- `PageSlotContext` (`app.page`) is **new in the SDK, not new on the wire** —
  `PageBlockHost` has always sent `{ slug, subPath, viewerUserId, viewerUsername?,
  theme? }`; page authors just had no name for it.
- `ModelSlotContext` **loses `creatorUserId`, `viewerUserId`, `viewerNsfwEnabled`,
  `viewerUsername` and `viewerStatus`.** The host's `projectBlockInitContext`
  allowlist has never forwarded them, so the first three were declared REQUIRED
  while arriving `undefined` — TypeScript said `number`, the wire said nothing.
  This is a **type-level fix to an existing latent bug**, not a removal of data.
  A block reading `ctx.creatorUserId` was already reading `undefined`; it now
  fails to compile, which is the point.

**2. `TOKEN_REFRESH_RESPONSE.payload.requestId` is REQUIRED (was optional).**
A reply that may not name its request is not usable as a reply. The transport
correlates strictly by `requestId`, so a response without one has *always* failed
to resolve `useBlockToken().refresh()` — it only ever appeared to work through
the side effect that applies the token to the snapshot regardless of correlation.
For a non-React consumer building against the wire there is no side channel at
all. The host now echoes the field unconditionally (it previously spread it in
via `...(requestId ? … : {})`, a truthiness test that dropped an empty string
too), and answers an uncorrelatable `REQUEST_TOKEN` with a `TOKEN_REFRESH` push
— which is what it semantically is.

**3. `BlockInitPayload.blockId` / `.appId` are `@deprecated` — and still sent.**
**4. `ViewerInfo` gains `signedIn?: true`; `id` / `username` are `@deprecated`
— and still sent, still object-or-null.**

🔴 **Why 3 and 4 stop at deprecation.** Removing a field from `BLOCK_INIT` is not
a type change: `isValidBlockInitPayload` is compiled into every already-built,
already-deployed block bundle, and it hard-requires a non-empty `blockId` and
`appId` and a `viewer` that is `null` or an object with a numeric `id`. Fetching
the bundles served from the 9 live `<slug>.civit.ai` apps and executing their own
copy of that guard confirms it: dropping `blockId`, dropping `appId`, or thinning
`viewer` to a boolean each returns `false`, and a rejected `BLOCK_INIT` is never
re-sent — the block stays blank forever. That is a fleet-wide outage. Separately,
5 of those 9 apps read `viewer.id` at runtime for load-bearing logic (ownership
filters, optimistic row authorship). Nothing reads `blockId`/`appId` off
`useBlockContext()` — the type deprecation is safe, the wire removal is not.

The staged path: ship the deprecations and `signedIn` (this release) → blocks
migrate to `viewer?.signedIn` for the sign-in gate and `useViewer()` for
identity, and to their own manifest for `blockId`/`appId` → once the deployed
population is known to run a validator tolerant of their absence, drop them from
the wire. The SDK starter and the `hello-world` example are migrated here as the
reference for step two.

**Back-compat, both directions.**

- **OLD block / NEW host** — unaffected. No field was removed from the wire, and
  the only addition is `viewer.signedIn`, which an older guard ignores.
- **NEW SDK / OLD host** — nothing hangs. `isValidTokenRefreshResponse` stays
  deliberately LOOSER than the (now-required) type and keeps accepting a reply
  with no `requestId`, or an empty one, so the token still reaches the snapshot
  against a pre-v2 host. Tightening it to match the type would drop the message
  before that side effect runs, turning a degraded path into a broken one — the
  guard carries a comment saying so. A host that never sends `viewer.signedIn`
  leaves it `undefined`, for which `viewer !== null` remains the documented
  fallback and means exactly the same thing.

**Ordering.** SDK and host are independent and can ship in either order; nothing
here is a coordinated cutover. Shipping the host first means blocks get
`signedIn` and an unconditional `requestId` before any block asks for them.
Shipping the SDK first means block authors get the types and guards while the
host still omits `signedIn` — the documented `viewer !== null` fallback covers
that window.
