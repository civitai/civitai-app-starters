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
  allowlist does not forward them (they rode the wire before that
  data-minimisation projection landed — which is what it was written to stop —
  and have not since), so the first three were declared REQUIRED while arriving
  `undefined` — TypeScript said `number`, the wire said nothing.
  This is a **type-level fix to an existing latent bug**, not a removal of data.
  A block reading `ctx.creatorUserId` was already reading `undefined`; it now
  fails to compile, which is the point.

🔴 **The guards check every field they assert, not just `slotId`.** Because
`UnknownSlotContext` declares `slotId: string`, a structurally-incomplete known
slot — `const c: BlockContext = { slotId: 'model.sidebar_top' }` — is a legal
`BlockContext` and **compiles**. A `slotId`-only guard would return `true` for it
and hand the block `ctx.modelId` typed `number` and valued `undefined`, straight
into a generation body. So `isModelSlotContext` also requires `modelId`,
`modelVersionId`, `modelName`, `modelType` and `modelNsfwLevel`, and
`isPageSlotContext` requires `slug`, `subPath` and `viewerUserId`. No real
payload is rejected: the only production model-slot producer sets all five
unconditionally and `CONTEXT_ALLOWLIST` forwards them, `subPath` is checked as a
string (not a non-empty one, since `''` is the real value on an app's index) and
`viewerUserId` accepts `null` (the real anonymous value).

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
`appId` and a `viewer` that is `null` or an object with a numeric `id` and a
PRESENT `username` (`null` is fine; absent is not). Fetching block bundles from
`<slug>.civit.ai` and executing their own copy of that guard confirms it:
dropping `blockId`, dropping `appId`, thinning `viewer` to a boolean, or omitting
`username` each returns `false`.

**What that population is.** `app_blocks` has 21 rows — 9 `approved`, 12
`suspended` — of which 20 are deployed and reachable. Only approved blocks are
served today (both surfaces gate on `status='approved'`), so the currently-served
set is the 9. But suspension is **reversible**, so the set a wire change must
stay compatible with is every deployed bundle, not just today's served ones. The
guard was executed out of 19 of those 20 bundles, unanimously — so this is 19/20
of the compatibility population, not a sample of a handful, and not a claim about
all 20.

A rejected `BLOCK_INIT` **is** re-sent — the host re-posts it every
`INIT_RETRY_INTERVAL_MS` (400ms) until the block acks `BLOCK_READY` — but every
retry carries the same payload, so a validator that rejects one rejects all ~25
of them, and at `BLOCK_READY_TIMEOUT_MS` (10s) the host gives up and settles on
its terminal failure state: the model slot collapses to nothing (`IframeHost`
renders `null` so the slot takes no space), and the page host shows its fallback
and reports the launch as an error. So the block never works — it just fails in
10s rather than hanging forever. That is a fleet-wide outage. Separately,
5 of the 9 approved apps read `viewer.id` at runtime for load-bearing logic
(ownership filters, optimistic row authorship). Nothing reads `blockId`/`appId`
off `useBlockContext()` — the type deprecation is safe, the wire removal is not.

One consequence, applied here: `isValidBlockInitPayload` **no longer rejects a
malformed `viewer.signedIn`**. An earlier revision failed the whole payload when
the flag was present and not `true`. That is the wrong-sized response by the very
argument above — this guard gates the ENTIRE init, so a bad advisory flag would
have cost the block its token, context, settings and theme, and the retry loop
would replay the same rejection for 10s and then abandon the launch. It is
unreachable from today's host (which writes a literal `true`), which is exactly
why the strict version bought nothing and risked a fleet-wide brick the day a
host wrote `signedIn: !!user`. A block should compare it to `true` and fall back
to `viewer !== null`.

The staged path: ship the deprecations and `signedIn` (this release) → blocks
migrate off `viewer.id`/`viewer.username` to a `viewer !== null` sign-in gate and
`useViewer()` for identity, and to their own manifest for `blockId`/`appId` →
once the host emits `signedIn` in production, `viewer?.signedIn === true` becomes
the gate to write → once the deployed population is known to run a validator
tolerant of their absence, drop `id`/`username` from the wire. The SDK starter
and the `hello-world` example are migrated here as the reference; note they use
`viewer !== null`, **not** `viewer?.signedIn`, because a block that gates on
`signedIn` before the host emits it renders its anonymous branch to every
signed-in user. Both dev hosts do emit it, so it is exercisable locally today.

The dev hosts also stop sending `viewer.status`. The platform withholds the
viewer's moderation state from third-party iframes (civitai #2521) — `status` is
`@deprecated` for exactly that reason — so a mock that sent it was inviting
blocks to read a field production never provides, the same fidelity defect this
release fixed in the seven context harnesses. `GET_VIEWER` / `useViewer()` still
carries `status`; that read is scope-gated and audited.

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
