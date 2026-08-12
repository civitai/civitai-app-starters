# @civitai/blocks-react

## 0.40.0

### Minor Changes

- 36bf402: `BLOCK_INIT` v2 — type the slot context, require the token-reply's `requestId`,
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
  correlates strictly by `requestId`, so a response without one has _always_ failed
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

  A rejected `BLOCK_INIT` **is** re-sent — one immediately, then one every
  `INIT_RETRY_INTERVAL_MS` (400ms) until the block acks `BLOCK_READY`, about 25 of
  them inside one `BLOCK_READY_TIMEOUT_MS` (10s) window — and it does not help.

  🔴 **Two corrections to how that was previously described, because both were
  wrong in ways that matter to anyone reasoning about a wire change.**

  _The retries are not byte-identical._ `IframeHost` and `PageBlockHost` both
  re-point `buildInitPayloadRef.current` on **every render**, deliberately, so a
  retry tick posts the freshest data (a checkpoint or showcase query that resolved
  after the controller started). The structural conclusion is unchanged — that
  freshness varies query-resolved **values**, never whether a required **field** is
  present, so a guard rejecting for a missing field rejects every retry too — but
  the reason is "the defect is invariant across retries", not "the payload is".

  _"At 10s the host gives up" is true of only one of the two surfaces._

  - **Model slot (`IframeHost`)** — no auto-retry. Status goes `timeout`,
    `hostRenderDecision` returns `collapse`, and it renders `null` so the slot
    takes no space. One handshake round, over at ~10s.
  - **Page host (`PageBlockHost`)** — `timeout` is auto-retryable, with
    `MAX_AUTO_RETRIES = 2` and `AUTO_RETRY_BACKOFF_MS = [2000, 5000]`. Each
    automatic attempt disposes the controller, remounts the iframe and builds a new
    one, so it is a **full fresh handshake** — its own ~25 posts, its own 10s
    window. Three rounds, ~37s of wall clock, then the terminal fallback with a
    prominent manual Retry, and the launch reported as an error.
    (`worstReachableLaunchMs()` = 57s bounds the worse path where a token wait is
    also paid.)

  Either way the block never works — it fails in 10s or 37s rather than hanging
  forever. That is a fleet-wide outage. Separately, 5 of the 9 approved apps read
  `viewer.id` at runtime for load-bearing logic (ownership filters, optimistic row
  authorship). Nothing reads `blockId`/`appId` off `useBlockContext()` — the type
  deprecation is safe, the wire removal is not.

  One consequence, applied here: `isValidBlockInitPayload` **no longer rejects a
  malformed `viewer.signedIn`**. An earlier revision failed the whole payload when
  the flag was present and not `true`. That is the wrong-sized response by the very
  argument above — this guard gates the ENTIRE init, so a bad advisory flag would
  have cost the block its token, context, settings and theme, and the retry loop
  would replay the same rejection for the whole window before abandoning the
  launch. It is unreachable from today's host, though **not** because the host
  writes a literal `true`: on `civitai/civitai@main` the identifier `signedIn`
  appears **zero times** under `src/components/AppBlocks/`, so the host sends no
  value at all to be malformed. The host that writes the literal `true` is
  civitai/civitai#3707, which is **open and unmerged**. Either way the strict
  version bought nothing and risked a fleet-wide brick the day a host wrote
  `signedIn: !!user`. A block should compare it to `true` and fall back to
  `viewer !== null`.

  🔴 **The host counterpart is civitai/civitai#3707, and it is OPEN and unmerged
  as of this changeset.** That is the PR that adds `signedIn` to
  `projectBlockInitViewer` and to `PageBlockHost`'s prop path, and that moves the
  host's pinned viewer key set from `['id', 'username']` to
  `['id', 'signedIn', 'username']`. On `civitai/civitai@main` today the identifier
  appears zero times under `src/components/AppBlocks/`. Nothing in this release
  depends on it landing — but nothing in this release should be read as evidence
  that it has.

  The staged path: ship the deprecations and `signedIn` (this release) → blocks
  migrate off `viewer.id`/`viewer.username` to a `viewer !== null` sign-in gate and
  `useViewer()` for identity, and to their own manifest for `blockId`/`appId` →
  once #3707 lands and the host emits `signedIn` in production,
  `viewer?.signedIn === true` becomes the gate to write → once the deployed
  population is known to run a validator tolerant of their absence, drop
  `id`/`username` from the wire. The SDK starter and the `hello-world` example are
  migrated here as the reference; note they use `viewer !== null`, **not**
  `viewer?.signedIn`, because a block that gates on `signedIn` before the host
  emits it renders its anonymous branch to every signed-in user. Both dev hosts do
  emit it, so it is exercisable locally today — which also means a local green is
  NOT evidence the field is on the production wire.

  If #3707 is abandoned rather than merged, the unwind is one change: drop
  `signedIn` from `createMockHost`'s `DEFAULT_VIEWER`, from `createLiveHost`'s
  `anonFallbackViewer` and `/blocks/me` projection, and from the key-set fences in
  `blockInitV2.test.ts` / `liveHost.test.tsx`. The type can stay — it is optional,
  and an absent field is exactly what it already models.

  The two dev hosts' **default** viewers stop sending `viewer.status`. The platform
  withholds the viewer's moderation state from third-party iframes (civitai #2521)
  — `status` is `@deprecated` for exactly that reason — so a default that sent it
  was inviting blocks to read a field production never provides. `GET_VIEWER` /
  `useViewer()` still carries `status`; that read is scope-gated and audited.

  🔴 **Scoped precisely, because "the dev hosts stop sending `status`" would
  overstate it.** What changed is `createMockHost`'s `DEFAULT_VIEWER` and
  `createLiveHost`'s `anonFallbackViewer` + `/api/v1/blocks/me` projection. An
  explicitly caller-supplied viewer is still forwarded **verbatim**, `status` and
  all, by both hosts (`MockHostOptions.viewer`, `LiveHostOptions.viewer`), and
  `mockHost.test.tsx` asserts that round-trip on purpose — an override is a
  deliberate act by a harness author, not a fidelity claim by the host. Around 26
  existing `blocks-react` `BLOCK_INIT` fixtures (grep-counted, so a floor) still
  build `viewer: { id, username, status: 'active' }` and are untouched. That is
  **pre-existing, not a regression**, and it is not claimed to be fixed here.

  Separately, the seven starter/example **context** harnesses did have the
  both-wrong-blind defect fixed outright: each was sending `creatorUserId`,
  `viewerUserId`, `viewerNsfwEnabled`, `viewerUsername` and `viewerStatus` in
  `ModelSlotContext`, none of which the host's `CONTEXT_ALLOWLIST` forwards. Those
  lines are deleted. The `viewer.status` change above is the same _shape_ of defect
  narrowed to two defaults — not the same _scope_ of fix.

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

- 42bdd33: Add a `THEME_CHANGE` host→block push so a mounted block follows the viewer's
  light/dark toggle.

  Before this the host handed a block its theme exactly once — in `BLOCK_INIT` and
  (where enabled) in the iframe URL fragment — and neither could change afterwards:
  `BLOCK_INIT` is deduped by the transport, and the host freezes the fragment at
  mount so a toggle cannot re-navigate a third-party frame. A viewer flipping dark
  mode left every open block rendering the old theme until it was reloaded.

  - `@civitai/app-sdk`: new `THEME_CHANGE` variant on `ParentToBlockMessage`,
    carrying `{ theme }`. Host-initiated, no `requestId` (mirrors `TOKEN_REFRESH`).
  - `@civitai/blocks-react`: the iframe transport validates and applies it to the
    snapshot; new `useBlockTheme()` hook returns the live value, and
    `useBlockContext().theme` tracks it too. The host forwards the theme twice —
    top-level and inside `BLOCK_INIT.context` — so the push updates
    `context.theme` as well when the host sent that field, keeping both documented
    readers (`useBlockContext().theme` and `ModelSlotContext.theme`) in step. It is
    never introduced on a context that lacked it. `createMockHost` / the `dev:live`
    host gain `setTheme(theme)` so the push can be exercised locally.

    Frozen on the v1 inline transport, which receives no host pushes at all — same
    degradation as an older host.

  Purely additive in both directions. A deployed block on an older SDK has no
  handler, so the message falls through its transport's no-op tail and it is
  completely unaffected. A new block against an older host never awaits the
  message — the theme just never moves, i.e. today's behaviour.

### Patch Changes

- 31f5c55: Make `WorkflowBodyCustomComfy` a discriminated union on `mode`, and delete the false "the iframe never sends a graph" claim.

  The host has shipped an INLINE-GRAPH arm of `customComfy` (`mode: 'inline'`) — a block can ship the ComfyUI graph itself instead of naming a server-registered recipe. The SDK's type did not have it, and worse, its doc comment asserted the opposite: "there is no way for a block to run an arbitrary/unreviewed graph". That sentence was written when it was true and was never revisited. In a blind dogfood a developer working against the live feature read it, believed it over their own instinct, and concluded the capability did not exist.

  `WorkflowBodyCustomComfy` is now `WorkflowBodyCustomComfyRecipe | WorkflowBodyCustomComfyInline`, mirroring the host's `blockCustomComfyMemberSchema`:

  - `WorkflowBodyCustomComfyRecipe` — the existing shape, unchanged except that `mode` is now an OPTIONAL `'recipe'` literal. A body that omits `mode` still lands here, so every deployed block and every body written against an earlier SDK is byte-identical and keeps working. (The host declares it `.optional()` and specifically NOT `.default()` for this reason.)
  - `WorkflowBodyCustomComfyInline` — `{ kind, mode: 'inline', workflow, resources, prompt?, negativePrompt?, maxBuzz }`, matching the host's `.strict()` `blockInlineComfyBodySchema` field-for-field. `InlineComfyNode` (`{ class_type, inputs }`) is exported alongside it.

  The new doc comments describe what is actually enforced: the arm is developer-only and page-token-only; code review is replaced by three fail-closed server gates (AIR containment over the declared `resources`, an entitlement belt stricter than the onsite generator, and a moderation sweep over every string leaf in the graph); and `maxBuzz` is documented as what it really is — the host stamps `stepTimeoutSeconds = maxBuzz`, so it is simultaneously the Buzz ceiling and the step timeout in seconds, and setting it low to be thrifty buys a silently `expired` job rather than a cheap one.

  The package README's type inventory now lists the new exports and explains the two arms, so the shipped npm page describes the same contract the types do — including that the inline arm is developer-only and page-token-only, and that a registered recipe is still how a graph reaches every viewer.

  Wire parity is pinned against the HOST'S OWN fixtures rather than against our mental model of them: `test/blocks/inline-comfy-wire-parity.test-d.ts` transcribes the payloads from civitai's `workflow.schema.inline-comfy.test.ts` and asserts each body the host ACCEPTS satisfies these types, each field the host `.strict()`-REJECTS (`sessionOwnerApiToken`, `comfyImage`, `minVramGb`, `sessionId`, `useSageAttention`, `minimumDurationSeconds`, `trace`) stays unassignable, and the mode-less recipe body every deployed block sends still type-checks.

  Additive for producers; narrowing for consumers that read `customComfy` fields without a second narrow on `mode` — which is the union doing its job. `@civitai/blocks-react`'s mockHost `preferredAccountType` is fixed accordingly (an inline body has no `params.accountType`; it resolves to Auto host-side, so `undefined` is the accurate answer). No runtime behaviour changes in either package.

- Updated dependencies [77ce989]
  - @civitai/components@0.3.1
  - @civitai/theme@0.2.1

## 0.39.0

### Minor Changes

- 1b7064f: Long-poll the orchestrator instead of timer-polling it, and give blocks a push-shaped API.

  **`@civitai/app-sdk` — `pollWorkflow` is now actually a long poll.**
  It was documented as a "Server-side long-poll helper" and was a client-side
  `setTimeout` loop re-reading the workflow every second with no `wait` parameter.
  The orchestrator has supported `GET /v2/consumer/workflows/{id}?wait=<seconds>`
  all along. `getWorkflow` gains `{ waitSeconds, signal }` and `pollWorkflow`
  defaults to a 20s hold per attempt, re-arming across each 202 until the workflow
  ends. On the default 30s budget that is ~2 requests instead of ~30, and terminal
  status is detected when the workflow ends rather than on the next tick after it
  ended. The return contract is unchanged, `waitSeconds: 0` restores the old
  behaviour, and `intervalMs` is retained as a floor so a host that ignores `wait`
  cannot turn the loop into a request storm. `signal` now reaches `fetch`, so a
  held request is genuinely cancelled rather than merely abandoned.

  The four starters gain this for free: they already pass `timeoutMs`, and the
  hold is clamped down to whatever is left of that budget (so their `wait=0`
  default path is byte-identical to today).

  **`@civitai/app-sdk` — `POLL_WORKFLOW` accepts an optional `waitSeconds`.**
  Additive and backward-compatible in both directions: a host that does not read
  the field answers immediately as today, and a block that never sends it is
  unaffected by a host that does. Only send it from a loop that awaits each poll.

  **`@civitai/blocks-react` — `useBuzzWorkflow()` gains `watch()`.**
  `watch(workflowId, { onUpdate, signal, waitSeconds, intervalMs, timeoutMs,
maxRetries })` resolves with the terminal snapshot and pushes every intermediate
  one to `onUpdate`, replacing the `useEffect` + `setTimeout` backoff blocks used
  to hand-write around `poll()`. The loop is sequential and non-overlapping by
  construction — exactly one request per watched workflow is ever in flight, which
  is what makes a long hold safe — and it absorbs a bounded burst of transient
  poll failures instead of ending a generation on one blip. `poll()` is unchanged
  and stays as the single-round-trip primitive.

  Also corrects two false docstrings on `useBuzzWorkflow`: it no longer tells
  callers to write their own polling loop, and `WorkflowBody` is now documented
  with all three union members (the `kind: 'step'` arm shipped in
  `@civitai/app-sdk@0.30.0` and was missing).

- 8d10446: Iframe wire contract: URL-fragment fast path for `theme`/`renderMode`/`blockInstanceId`, plus a `BLOCK_HELLO` readiness announce.

  Both changes are **additive fast paths**. The `BLOCK_INIT` payload remains authoritative and still carries all three fields; a block is still only `ready` once the payload lands; and **no token is ever put in the URL**.

  - `@civitai/app-sdk/blocks` gains `encodeBlockInitFragment` / `parseBlockInitFragment` / `stripBlockInitFragment` and the `BLOCK_INIT_FRAGMENT_*` constants. Wire format v1 is `#civitai-block=v1&theme=…&renderMode=…&blockInstanceId=…`; an absent, foreign, or unknown-version fragment decodes to `{}`.
  - `BlockToParentMessage` gains `{ type: 'BLOCK_HELLO' }` — a contentless announce the transport posts the moment its `message` listener is attached, so the host can push `BLOCK_INIT` in response instead of waiting out its retry tick.
  - `IframeTransport` seeds its pre-init snapshot from the fragment when one is present (and strips only its own keys from the visible URL, best-effort), then posts the announce.

  **Compatibility.** A new block against an old host sees no fragment and no answer to its announce, and falls back to waiting for `BLOCK_INIT` — today's behaviour exactly. A host that never receives the announce still delivers `BLOCK_INIT` on its own bounded retry/timeout schedule, so the announce can never hang a block or a host.

## 0.38.0

### Minor Changes

- f314e51: Batch D money slice: idempotency keys for the paid paths + a tip-allowance read.

  - `useBuzzWorkflow().submit(body, { idempotencyKey? })` and the `SUBMIT_WORKFLOW`
    message now carry an OPTIONAL client idempotency key. The host threads it to the
    orchestrator dedupe so a lost-response / timeout retry collapses to ONE Buzz
    charge instead of double-charging. Omit it and each `submit()` mints a fresh key
    (today's behavior); pass a stable key (e.g. a grid-cell id) to make a retry safe.
  - New `useTip()` hook — a REST wrapper for the block tip endpoint with the same
    optional `idempotencyKey` (a retry with the same key is collapsed server-side to
    the first result, so a timeout can't double-tip).
  - New `useTipAllowance()` hook — reads the viewer's REAL remaining daily tip
    allowance `{ cap, spent, remaining }` (scope `social:tip:self`) so a block can
    show a genuinely-tracked ceiling instead of a dead client-side full-cap guess.

  All additive/backward-compatible: an older host that ignores the new field simply
  never dedupes; old-shape hook calls keep working unchanged.

- ce7611e: Surface the App Blocks Batch-D platform seams as hooks: `useSharedStorage().get()` / `.report()` / per-item `viewerVoted`, and a new `useSaveImage()`.

  - **`useSharedStorage().get(key)`** — resolve ONE shared entry by key (`SharedListItem | null`), for a `?g=<key>` deep-link to any item, not just the first page. Respects the same per-viewer visibility as `list` (a hidden/withdrawn row resolves to `null`).
  - **`useSharedStorage().report(key, reason?)`** — report a posted entry for moderator review. Trust-gated + rate-limited server-side (same `apps:storage:shared:write` boundary as `append`).
  - **`SharedListItem.viewerVoted: boolean`** — hydrate a vote button's state on load instead of guessing (fixes the "double-click to unvote" bug). `list()` and `get()` both populate it; it defaults to `false` when talking to an older host that doesn't send the field, so a new block on an old host degrades to today's behavior. Anonymous viewers are always `false`.
  - **`useSaveImage()`** — `saveImage({ url, filename? })` for the block's OWN output (origin-allowlisted host-side to the civitai image/blob CDN) or `saveImage({ imageId, filename? })` for a cross-user grid image (routed through the gated per-viewer read, so a withheld image can't be saved). The host does the blob fetch + download in its unsandboxed top frame — the only way a sandboxed block (no `allow-downloads`) can save a paid output.

  Adds transport-boundary validators for the three new `*_RESULT` replies (a malformed reply is dropped rather than resolving a promise with corrupt data), and the mock host now serves `SHARED_GET` / `SHARED_REPORT` / `SAVE_IMAGE` for local dev. All additive; existing hooks and blocks are unaffected.

### Patch Changes

- b773b0b: Widen the `@civitai/app-sdk` peer range to `>=0.29.0 <1.0.0` (was `^0.28.0`).

  `^0.28.0` on a **0.x** package means `>=0.28.0 <0.29.0`, so every SDK _minor_ put the
  peer out of range. With `onlyUpdatePeerDependentsWhenOutOfRange: true` in
  `.changeset/config.json`, changesets then promotes the peer-dependent to a **major** —
  which is why the first release after the Batch-D SDK minor computed
  `@civitai/blocks-react` **1.0.0** out of four changesets that all declared `minor`.

  That was mechanical, not a stability declaration, and it recurred: the regenerated
  range would have been `^0.29.0`, taking the next SDK minor to `2.0.0`, then `3.0.0` —
  one major burned per SDK minor.

  With the range spanning the whole 0.x line, an SDK minor stays in range and
  `blocks-react` versions on its own changesets again (verified: this release now
  computes `0.38.0` / `0.29.0`, and the range is not rewritten).

  The floor is `0.29.0`, not `0.28.0`: this package's `useSaveImage` /
  `useSharedStorage` hooks depend on message types that ship in the same release, so
  `0.28.0` is not a compatibility claim that can be substantiated.

## 0.37.0

### Minor Changes

- 2238b41: Move the `@civitai/app-sdk` peer range to `^0.28.0`, in lockstep with the SDK
  minor that adds the optional manifest `tagline`.

  No functional change here — this package's code is untouched. The bump exists
  because a pre-1.0 caret pins the minor: `^0.27.0` means `>=0.27.0 <0.28.0`, so
  leaving it would put the peer out of range the moment `@civitai/app-sdk` goes to
  `0.28.0`. Changesets would then bump this package as an out-of-range peer
  dependent, which it treats as a breaking change and resolves to a phantom
  `1.0.0`. Setting the range to the _actual_ resulting SDK release keeps it in
  range, so the release stays inside 0.x. Same lockstep the `safe-storage` minor
  used.

  `minor` rather than `patch` is deliberate: this raises the minimum peer a
  consumer must satisfy. As a patch it would reach anyone tracking `^0.36.0`
  automatically and conflict with an `@civitai/app-sdk` pinned to `^0.27.0`; as a
  minor, existing `^0.36.x` consumers stay put and pick it up when they move the
  SDK too.

## 0.36.1

### Patch Changes

- Updated dependencies [6b0a2e6]
  - @civitai/components@0.3.0

## 0.36.0

### Minor Changes

- 0db05b7: Auto-install the SDK's opaque-origin web-storage shim on import, so React blocks (and any block using this package's transport) can't be taken down by a dependency that touches `localStorage` / `sessionStorage` unguarded.

  `src/index.ts` now imports `@civitai/app-sdk/safe-storage` first. That module replaces `localStorage` / `sessionStorage` with an in-memory `Storage` only when a round-trip probe proves them unusable — working storage is untouched, a store that reads but refuses writes has its entries carried over, nothing is fabricated in Node/SSR, and it's idempotent. Nothing to call, no API change here.

  `package.json` also declares `"sideEffects": ["./dist/index.js"]`. That import is the entire mechanism, and it is a bare side-effect import: without the declaration, a later blanket `"sideEffects": false` would let a bundler skip this entry module and drop the shim, with every test still green.

  Bumps the `@civitai/app-sdk` peer range to `^0.27.0` (the minor that adds the `safe-storage` subpath), matching the established lockstep pattern.

## 0.35.2

### Patch Changes

- Updated dependencies [cce1716]
  - @civitai/components@0.2.1

## 0.35.1

### Patch Changes

- Updated dependencies [b896dd9]
  - @civitai/theme@0.2.0
  - @civitai/components@0.2.0

## 0.35.0

### Minor Changes

- ae7aa83: 🎨 **VISIBLE REPAINT — `@civitai/blocks-react/ui` migrated onto the published design system** (civitai/civitai-app-starters#185).

  The `/ui` component pack no longer bundles its own private `--ci-*` token palette or the CSS for its 10 presentational components. It now **delegates** to the published design-system packages **`@civitai/theme` + `@civitai/components` (0.1.2)** — added as runtime dependencies — and keeps only the 5 interactive components' CSS in-package (Modal / Select / Slider / Collapse / SegmentedControl), repointed onto the `--civitai-*` tokens. `injectBlocksStyles()` now injects three separately-marked `<style>`s (theme tokens + components CSS + the interactive-5 sheet); each has its own idempotency marker so they compose cleanly in the sandbox iframe.

  **This changes how live App Blocks LOOK.** The design-system tokens differ from the retired `--ci-*` palette — the visible deltas are:

  - **Corner radius 8px → 4px** (all buttons, inputs, cards, alerts, modal, segmented control).
  - **Success green → teal** (light `#2f9e44` → `#299C7A`, dark `#51cf66` → `#326D5C`) — Button/Badge `color="success"`, Alert `color="success"`.
  - **Dark primary `#228be6` → `#1971C2`** (filled buttons/badges + accents in dark theme).
  - **Dark hover direction reverses** (`colorPrimaryHover` `#339af0` → `#1864AB`): filled buttons/badges now **darken** on hover in dark mode instead of brightening.
  - **SegmentedControl track `#f4f4f5` → `#fefefe`** (in light; the active pill now separates from the track by shadow, not background).
  - Smaller error / warning / info / border / text / font-stack shifts.

  **Why minor (pre-1.0 breaking signal):** this is a behavioral break — the visual repaint plus the `--ci-*` → `--civitai-*` inline-var rename (any block author who overrode `--ci-color-primary` etc. directly must update to `--civitai-color-primary`). Per this repo's pre-1.0 convention a **minor** is the breaking signal; flag for the maintainer if you'd rather cut a **major** to shout it louder.

  **Rollout is per-app, NOT instant.** Block CSS is bundled **per-app**, so publishing this package repaints a given block **only when that block's author bumps `@civitai/blocks-react` and redeploys** — the repaint rolls out gradually, app by app. **Rollback = pin the previous `@civitai/blocks-react` version** in the affected app and redeploy.

  **Public API preserved.** All `/ui` components keep their props and markup contract. The Badge `color` prop still accepts any CSS color string (kept the inline `--civitai-color-primary` override rather than mapping to `@civitai/components`' new `data-color`, which only covers the 4 named intents).

## 0.34.0

### Minor Changes

- b9eccf6: `createMockHost` (the `@civitai/blocks-react/testing` harness) now documents and tests `customComfy` generation support, so a scaffolded App Block's `dev:harness` loop plus its unit/e2e tests can exercise a `{ kind: 'customComfy', recipe, params }` sample generation with no real backend.

  The estimate → submit → poll → terminal money path was already kind-agnostic — it drives both `WorkflowBody` arms (`textToImage` and `customComfy`) through the identical lifecycle, honors the same `generation` / `buzz` scenario config (`costPerGen` / `failRate` / `failNext` / `insufficient` / `latencyMs`), and stamps `spentAccountType` from the customComfy body's `params.accountType`. This release makes that a documented, tested contract:

  - A customComfy `estimate` returns a `cost.total` on a non-empty sentinel `workflowId` (survives the SDK inbound validator).
  - A customComfy `submit` polls to `succeeded` carrying an image url and a `cost`.
  - The fail / insufficient-Buzz / disallowed-account scenario config applies to customComfy identically to textToImage.
  - The mock accepts **any** `recipe` id without validating it against a registry (the recipe registry is server-only) — it stands in for the server, fail-open.

  No API surface change and no new config knobs; `@civitai/app-sdk` is unchanged (the `customComfy` `WorkflowBody` kind already ships there).

## 0.33.0

### Minor Changes

- 121c1b1: Convert `WorkflowBody` into a real discriminated union and add a bounded `customComfy` recipe member (App Blocks customComfy bridge, v1). Pure-additive and back-compatible: the existing `{ kind: 'textToImage', modelId, modelVersionId, params }` body is unchanged (now the exported `WorkflowBodyTextToImage` arm). The new `WorkflowBodyCustomComfy` (`{ kind: 'customComfy', recipe, params: { prompt, seed?, engine?, accountType? } }`) runs a server-registered, code-reviewed ComfyUI recipe end-to-end — the iframe never sends a graph; `recipe` is a registered id (unknown ids rejected server-side, fail-closed) and `params` are bounded + validated per-recipe. Mirrors civitai's forthcoming `blockCustomComfyBodySchema`. Billing is post-paid (a per-recipe display estimate, no exact pre-price; a per-recipe `maxBuzz`/timeout caps the job server-side). `useBuzzWorkflow().{estimate,submit}` now accept the full union (type-only; the hook forwards the body verbatim, no runtime change). `@civitai/blocks-react`'s peer range on `@civitai/app-sdk` is bumped to `^0.26.0` to match this minor.

## 0.32.0

### Minor Changes

- 8163111: Add an "Open on Civitai" fallback for blocks loaded directly (top-level) instead of embedded.

  A block is served from `<slug>.civit.ai` but is designed to run embedded in the Civitai host iframe, which delivers its context via the `BLOCK_INIT` handshake. Opened directly (top-level navigation to the bare origin — a shared link, a social crawl), no parent ever sends `BLOCK_INIT`, so `ready` never flips and the block hangs on its loading spinner forever.

  New, in the SDK so every block degrades uniformly:

  - `<BlockGate>` (from `@civitai/blocks-react/ui`) — wrap your app root once; it renders a branded, theme-aware "Open on Civitai" landing (linking to `civitai.com/apps/run/<slug>`) on a direct load, and is a transparent pass-through otherwise.
  - `<DirectLoadFallback>` (from `/ui`) — the landing itself, for a custom gate.
  - `useDirectLoad()` and `hostToRunUrl()` (from the package root) — the detection hook and pure slug→URL helper, for building your own UI.

  The trigger is precise, so the embedded happy path and the dev harness are untouched: the fallback shows only when the block is top-level (`window.self === window.top`) **and** no `BLOCK_INIT` arrives within a short timeout (~2s, overridable). Framed blocks never trip it; the harness posts `BLOCK_INIT` immediately, so it never trips there either. On a non-`*.civit.ai` host (e.g. `localhost`), it shows a neutral "waiting for the host" state rather than a broken `apps/run/localhost` link.

## 0.31.0

### Minor Changes

- 0401e04: Add `SegmentedControl` to the `/ui` component pack — a horizontal view/tab
  switcher (`role="tablist"`), the primitive block authors previously hand-rolled
  as a Group-of-Buttons. Controlled: `data` (segments) + `value` + `onChange(value)`.
  Supports `size` (`sm | md | lg`), `fullWidth` (equal-width segments), per-segment
  and whole-control `disabled`, and ArrowLeft/ArrowRight roving selection across the
  enabled segments (roving tabindex, focus follows). Zero-dep and auto-themed via the
  existing `--ci-color-*` tokens (correct in light + dark).

## 0.30.0

### Minor Changes

- 88cf71d: Add the `PUBLISH_GENERATION_OUTPUTS`/`PUBLISH_RESULT` and `GET_IMAGES_BY_IDS`/`IMAGES_RESULT` block↔host message pairs, the `BlockGatedImage` per-viewer gated-image projection, and the `usePublishGenerationOutputs()` + `useGatedImages()` hooks. Bridges a block's own generation outputs into bare real-scanned public Image rows and reads them back under each viewer's browsing-level clamp.

## 0.29.0

### Minor Changes

- 5a3724d: Add `useAppWorkflows()` — the React hook for an app's **own** generator subqueue.
  Returns `{ workflows, cursor, loading, error, refetch, cancel }` (fetch-on-mount,
  paginated via `cursor`, unmount-safe, timeout-not-hang); `cancel(workflowId)` sends
  `CANCEL_APP_WORKFLOW` and optimistically splices the confirmed terminal state into
  `workflows` in place. Adds the `isValidAppWorkflowsResult` /
  `isValidCancelAppWorkflowResult` transport validators (accepting the legitimate
  `number | null` image dims / nsfwLevel / cost and `string | null` cursor), and
  `createMockHost` / `createLiveHost` coverage for both bridges. Requires
  `@civitai/app-sdk` ≥ 0.24.0 (peer range bumped to `^0.24.0`).

## 0.28.0

### Minor Changes

- f53903e: Add the missing trust-boundary validators, hook docs, and dev-harness coverage the last audit found — user-visible robustness, no message-contract change (the `@civitai/app-sdk` peer stays `^0.23.0`).

  - **Transport validators for 15 reply types that previously crossed the boundary unchecked** (`payloadValidatorFor` returned `null` for them, so a malformed host reply resolved the hook with `undefined`-typed-as-`number`/`string` — silent corruption, no throw, no timeout). Now wired into the same drop-on-malformed path as the already-validated bridges (a bad reply is dropped → the request rejects at its timeout instead of returning corrupt data):
    - the 5 `APP_STORAGE_*_RESULT` reads (`GET`/`SET`/`DELETE`/`LIST`/`QUOTA`) behind `useAppStorage`;
    - the 7 `SHARED_*_RESULT` replies (`LIST`/`GET_COUNT`/`GET_COUNTS`/`APPEND`/`VOTE`/`UNVOTE`/`WITHDRAW`) behind `useSharedStorage` — closes the `getCount`/`getCounts`/`append`/`vote`/`unvote`/`list` silent-corrupt-return hole;
    - `CHECKPOINT_PICKER_RESULT`, `RESOURCE_PICKER_RESULT`, and `USER_CHECKPOINT_SET` — the money-adjacent `versionId` a picker hands to a workflow body is now shape-checked (positive integer) at the boundary. Each validator matches the host's real reply shape (dates are ISO strings; error paths carry zeroed success fields; pickers omit `selected` on dismiss; nullish is accepted where the host sends it).
  - **README sections for 8 previously-undocumented exported hooks**: `useSharedStorage`, `useResourcePicker`, `useImageUpload`, `useGenerationResources`, `useRequestSignIn`, `useRequestConsent`, `useDomainMaturity`, and `SfwGate` — each with a `typecheck:readme`-verified example.
  - **Dev-harness fidelity fixes** (a hook no longer hangs against a harness that models the protocol): `createMockHost` now answers `SET_USER_CHECKPOINT` (`useCheckpointPicker().persist()` no longer hangs); `createLiveHost` now forwards `OPEN_IMAGE_UPLOAD` (honest dismiss — no headless upload contract) and all eight `SHARED_*` bridges to `apps.shared.*` (`useSharedStorage` no longer hangs in `dev:live`).
  - **Smaller fixes**: `useGenerationResources` gained an `AbortController` + timeout + unmount-cancel (the only fetch path that could hang indefinitely); `useBlockToken`'s refresh-dedup is now keyed by `blockInstanceId` (a latent inline-mode v2 bug where one instance's token refresh coalesced onto another's).

## 0.27.0

### Minor Changes

- c5ef2df: Add the non-blocking (async-scan) cosmetic-image upload flow for App Blocks: the host early-resolves the upload modal on persist and streams the scan verdict to the block, so a display upload no longer blocks on the scan.

  - **app-sdk (`@civitai/app-sdk/blocks`):** new `BlockPendingImageInfo` (`{ status: 'pending', imageId, url }` — an author-preview-only early-resolve handle) and `BlockImageScanResult` (the discriminated async verdict `scanned` | `blocked` | `error`), both re-exported from the blocks barrel. `OPEN_IMAGE_UPLOAD` gains an opt-in `asyncScan?: boolean` (absent/false = byte-compatible blocking path); `IMAGE_UPLOAD_RESULT.selected` widens to also carry the pending handle; and a new parent→block `IMAGE_SCAN_RESOLVED` message delivers the verdict (correlated by `requestId` + `imageId`). Only the `scanned` verdict carries a usable moderated image.
  - **blocks-react:** `useImageUpload({ asyncScan: true })` returns `{ open, scanStatus }` — `open()` early-resolves a `BlockPendingImageInfo` (or `null` on dismiss) and `scanStatus(handle)` resolves the streamed verdict (buffered if it arrives first; re-callable for retry; forgery-resistant correlation by the generated `requestId`). Existing overloads (blocking `display`, `generationSource`) are unchanged. A host that predates `asyncScan` (blocking-resolves a moderated image) is handled transparently — the hook treats it as immediately-scanned. `createMockHost` models the early-resolve → async verdict with a new `cannedImageScan` option (`'scanned'` default | `{ status: 'blocked', reason? }` | `'error'`).
  - The block-side security invariant is unchanged: the pending handle is author-preview-only, only a `scanned` verdict carries the moderated image projection, and cross-user serving stays gated server-side.

  blocks-react bumps its `@civitai/app-sdk` peer range `^0.22.0` → `^0.23.0` in lockstep (it consumes the new types), so the app-sdk minor does not force a blocks-react major.

## 0.26.0

### Minor Changes

- 522d051: Add `useViewer()` — the block-side hook for the `GET_VIEWER` → `VIEWER_RESULT` host bridge (host bridge `blocks.getMyViewer` shipped in parallel in civitai/civitai).

  - **`useViewer()`** — the signed-in viewer as an on-demand authoritative self-read (`{ id, username, status, buzzBudget? }`), distinct from `useBlockContext().viewer` (the coarse BLOCK_INIT-time snapshot). Follows the `useBuzzBalance` model exactly (fetch on mount, `refetch`, timeout-not-hang, unmount-safe); returns `{ viewer, loading, error, refetch }`. Exported from the package root along with its `UseViewer` type + the SDK's `BlockViewer`.

  The trust-boundary validator `isValidViewerResult` is wired into `payloadValidatorFor`; it validates `id` (number), `username` (`string | null`), `status` (`active`/`muted`), and `buzzBudget` (`number | null`) — per host PR #3152 both `username` and `buzzBudget` are present-but-NULLABLE, and the guard ACCEPTS `null` for both (rejecting a valid `null` is the too-strict-guard trap that previously hung a read hook on a null value). The `createMockHost` (canned viewer + `viewerError` knob) + `createLiveHost` (forwards to the `blocks.getMyViewer` tRPC mutation) dev harnesses answer the bridge.

  Also documents the hooks shipped in 0.25.0 that the README had not yet covered — `useBuzzTransactions`, `useBuzzAccounts`, `useDailyCompensation`, `useWildcardPack` — plus this release's `useViewer`.

  Bumps the `@civitai/app-sdk` peer dependency to `^0.22.0` (the new `GET_VIEWER` message types), matching the established lockstep pattern.

## 0.25.0

### Minor Changes

- c9548f3: Add React hooks for the buzz self-read + wildcard-pack host bridges, completing the block-side surface for the message pairs added to `@civitai/app-sdk` (host bridges shipped in civitai/civitai #3144 + #3133):

  - **`useBuzzTransactions(params?)`** — the viewer's Buzz-transaction ledger page (`GET_BUZZ_TRANSACTIONS`). Rehydrates each row's `date` (and normalizes `cursor`) — tolerating both an ISO string and a `Date` instance on the wire. `error` surfaces the host's free-text message.
  - **`useBuzzAccounts()`** — the viewer's all-pool balances (`GET_BUZZ_ACCOUNTS`).
  - **`useDailyCompensation({ date, source?, accountType? })`** — per-modelVersion generation compensation for the month of `date` (`GET_DAILY_COMPENSATION`), exposing `resources` + `hasPublishedResources`.
  - **`useWildcardPack(modelVersionId)`** — import a wildcard pack's parsed prompt lists (`GET_WILDCARD_PACK`). On failure `error` is a **`WildcardPackError`** whose `.code` is the discriminated reason (`not-found` | `forbidden` | `too-large` | `parse-failed` | `busy`), so a block can branch (e.g. retry on `busy`). A non-positive `modelVersionId` is a no-op.

  All four follow the `useBuzzBalance` model (fetch on mount, `refetch`, timeout-not-hang, unmount-safe). Each hook + its result types are exported from the package root, plus the SDK result types (`BlockBuzzTransaction`, `BlockBuzzAccount`, `BlockDailyCompensationResource`, `BlockWildcardPack`, `BlockWildcardPackErrorCode`) are re-exported.

  Trust-boundary validators (`isValidBuzzTransactionsResult` / `isValidBuzzAccountsResult` / `isValidDailyCompensationResult` / `isValidWildcardPackResult`) are wired into `payloadValidatorFor`; the wildcard guard enforces the CLOSED error enum (a rogue free-text error is dropped). The `createMockHost` + `createLiveHost` dev harnesses answer all four bridges (`createLiveHost` forwards the three buzz reads to their block-token tRPC mutations; wildcard import is dev:mock-only — it needs the session-authed in-tab zip parse — so `createLiveHost` replies with an honest `parse-failed`).

  Bumps the `@civitai/app-sdk` peer dependency to `^0.21.0` (the new message types), matching the established lockstep pattern.

## 0.24.0

### Minor Changes

- 0ae2821: Add `useSharedStorage().update(key, value)` — an author-scoped, in-place update of a SHARED-storage entry the viewer contributed. Mirrors the new civitai platform op `apps.shared.update`.

  - **`@civitai/app-sdk`** (`blocks`): new postMessage pair `SHARED_UPDATE` (block→parent, `{ requestId, key, value }`) and `SHARED_UPDATE_RESULT` (parent→block, `{ requestId, ok, error? }`). Reuses the existing `SharedStorageValue` (`{ title, body?, data? }`) — no new value type.
  - **`@civitai/blocks-react`**: `useSharedStorage()` gains `update(key: string, value: SharedStorageValue): Promise<void>` alongside `append`/`list`/`vote`/`unvote`/`withdraw`. Resolves once the update lands; rejects with the host's `error` (`NOT_FOUND` when the key is missing/hidden, `FORBIDDEN` when the viewer isn't the author, or a belt/size rejection). Gated by the same `apps:storage:shared:write` scope as `append` — no new scope. The entry's `key` and vote/report totals are preserved; only the contributed `{ title, body?, data? }` value changes.

  The `createMockHost` SHARED backend now answers `SHARED_UPDATE` (author gate + `NOT_FOUND`/`FORBIDDEN`/`INVALID_VALUE`), so `dev:mock` exercises the full author-scoped update path locally.

## 0.23.0

### Minor Changes

- 87d2286: Add form primitives to the `@civitai/blocks-react/ui` component pack: `Slider`, `NumberInput`, `Select`, and `Collapse`.

  These are the controls block apps (e.g. Custom Generators) previously hand-rolled on native elements; the pack versions let those apps drop the hand-rolls and get consistent theming + accessibility for free.

  - **`Slider`** — labeled range control (`value: number`, `onChange`, `min`/`max`/`step`, `disabled`, `showValue`). Native `input[type="range"]` — keyboard-operable, implicit `role="slider"`; accent tracks `--ci-color-primary`. (The LoRA-weights control.)
  - **`NumberInput`** — labeled numeric input (`value: number | null`, `onChange`, `min`/`max`/`step`, `disabled`). Rejects non-numeric input (never emits `NaN`), clamps to `[min, max]` on blur, empty → `null`. (steps / cfg / quantity params.)
  - **`Select`** — labeled dropdown (`value: string`, `onChange`, `options: {value,label,disabled}[]` or `<option>` children, `placeholder`, `disabled`). (sampler / base-model / workflow-type.)
  - **`Collapse`** — controlled disclosure (`open` + `onOpenChange`, `title`, `disabled`) for the "advanced params reveal" — `aria-expanded`/`aria-controls` wired, content region `hidden` when closed. (Optional extra.)

  All are controlled, ref-forwarded, and follow the pack's conventions: `useBlocksStyles()` auto-injection, `data-civitai-ui="…"` styling hooks, `data-theme` light/dark theming, and the shared `label` / `description` / `error` / `required` a11y wiring (`htmlFor`/`id`, `aria-describedby`, `aria-invalid`, `role="alert"`). Exported from `@civitai/blocks-react/ui`. No SDK change — UI only.

## 0.22.0

### Minor Changes

- 110b5a6: Add the `generationSource` image-upload mode to `OPEN_IMAGE_UPLOAD` (mirrors civitai/civitai #3141).

  `@civitai/app-sdk/blocks` (contract):

  - `OPEN_IMAGE_UPLOAD` request gains an optional `purpose?: 'display' | 'generationSource'`. Absent/omitted ⇒ `'display'` (the host normalizes an unknown value to the safe moderated default), so an older SDK stays byte-compatible.
  - `IMAGE_UPLOAD_RESULT.selected` is now a UNION keyed by the requested purpose:
    - `'display'` (existing): the MODERATED `BlockUploadedImageInfo` (`{ imageId, nsfwLevel, contentRating, url }`) — unchanged.
    - `'generationSource'` (new): the UNSCANNED private img2img source `{ url, width, height }` (no imageId/nsfwLevel; the orchestrator scans it at generation time). Exported as `BlockGenerationSourceImageInfo` (an alias of the existing `BlockSourceImage` — `WorkflowBody.sourceImage`'s type).
  - New exported `BlockUploadPurpose` (`'display' | 'generationSource'`) mirroring the host's type.

  `@civitai/blocks-react` (hooks/mock):

  - `useImageUpload()` accepts an options arg `useImageUpload({ purpose }?)`, typed by purpose via overloads: `purpose: 'generationSource'` → `open(): Promise<BlockGenerationSourceImageInfo | null>`; default / `'display'` → `open(): Promise<BlockUploadedImageInfo | null>`. The `purpose` is passed through on `OPEN_IMAGE_UPLOAD` (omitted for the default mode to keep the wire byte-compatible). Keeps the 10-min timeout + `selected ?? null` cancellation.
  - The inbound `IMAGE_UPLOAD_RESULT` validator now accepts BOTH result shapes (moderated OR `{ url, width, height }`).
  - `createMockHost` returns the canned result for the requested `purpose` (a `{ url, width, height }` for `generationSource`, the existing moderated result for `display`), with a new `cannedGenerationSourceUpload` scenario knob — so `dev:mock` works for both modes.
  - Bumps the `@civitai/app-sdk` peer dependency to `^0.19.0`.

## 0.21.0

### Minor Changes

- 99af8a4: Expose the Custom Generators platform seams to block apps.

  `@civitai/app-sdk/blocks` (contract):

  - `WorkflowBody.textToImage` gains optional `sourceImage?: BlockSourceImage` (`{ url, width, height }`) for img2img — Civitai-hosted image, SD-family checkpoints, page apps only; all server-enforced. New `BlockSourceImage` interface.
  - `WorkflowBody.textToImage` gains optional `sharedContentKey?: string` — the shared-storage key the server resolves to the content author for attribution.
  - New `OPEN_IMAGE_UPLOAD` / `IMAGE_UPLOAD_RESULT` message pair (host-mediated block image upload) + `BlockUploadedImageInfo` (`{ imageId, nsfwLevel, contentRating, url }`), added to the inbound message validator.
  - `BlockResourceInfo` widened with the public recommended-settings projection: `strength?`, `minStrength?`, `maxStrength?`, `trainedWords?`, `clipSkip?` (mirrors the host's `SafeGenerationResource`).
  - `SharedStorageValue` gains an optional opaque `data?: unknown` (threaded through `SHARED_APPEND`).

  `@civitai/blocks-react` (hooks/REST):

  - New `useImageUpload()` hook (drives `OPEN_IMAGE_UPLOAD`).
  - New `useGenerationResources()` hook + pure `buildGenerationResourcesUrl` / `responseToResources` builders for `GET /api/v1/blocks/generation-resources` (rehydrate picked resources by version id, ≤30 cap).
  - `useSharedStorage().append` accepts the generic `{ title, body?, data? }` value.
  - `createMockHost` answers `OPEN_IMAGE_UPLOAD` and echoes shared-storage `data`, so `dev:mock` / `dev:live` mirror prod.

## 0.20.0

### Minor Changes

- 1171ecc: feat(blocks-react): expose the validated host origin via `useHostOrigin()`

  Blocks that need to direct-fetch the Civitai App Blocks HTTP API (bypassing the
  host bridge) must send their bearer block token to the RIGHT host. Add a public
  way to get that host: the origin the SDK already validated `BLOCK_INIT` came
  from — never a spoofable signal like `document.referrer`.

  - New React hook `useHostOrigin(): string | undefined` (sibling of
    `useBlockToken`, same `useSyncExternalStore` subscription). `undefined` until
    init, then exactly the validated parent origin.
  - New transport accessor `getHostOrigin(): string | null` on the `BlockTransport`
    interface, implemented by both `IframeTransport` (returns the `parentOrigin`
    captured from the first allowlist-passing `BLOCK_INIT`) and `InlineTransport`
    (returns the same-document host origin once bootstrapped).

  Security invariant: the returned value is ONLY ever an origin that passed the
  transport's trust gate (the iframe `OriginMatcher` allowlist, or the inline
  same-origin host). It is never derived from `document.referrer`,
  `window.location` of a cross-origin parent, or an unvalidated `event.origin`.
  The block token is a money-scoped bearer credential, so returning an unvalidated
  origin would be a token-exfiltration vector — a non-allowlisted `BLOCK_INIT` is
  dropped at the origin gate and the host origin stays null.

## 0.19.0

### Minor Changes

- 72fbf63: `createMockHost` gains per-account Buzz money-path parity so the scaffold no longer needs to patch around three mock-host gaps:

  - **Balance-read errors** — new `buzzBalanceError?: boolean | string | Error` option forces `GET_BUZZ_BALANCE` to FAIL (replying with the exact `{ requestId, error }` shape `createLiveHost` uses, no `balance`) so a block's balance-read error UI (`useBuzzBalance().error`) is exercisable locally. `true` → a default message, a string → that message, an `Error` → its `.message`.
  - **Disallowed-account rejection** — new `disallowedAccountTypes?: BuzzAccountType[]` option makes a `SUBMIT_WORKFLOW` whose `body.accountType` names a disallowed pool resolve to a `failed` snapshot carrying the real backend's content-rating message (exported as `disallowedAccountError(accountType)`). Checked BEFORE the insufficient-Buzz / generic-failure paths, mirroring the real backend rejecting at the currency-resolution boundary before any spend.
  - **Pick-aware `spentAccountType`** — the succeeded snapshot now stamps `spentAccountType` from the SUBMITTED `body.accountType` (the picked pool) instead of always the largest wallet pool, falling back to the largest-pool heuristic only when no `accountType` was submitted. FIDELITY CAVEAT: the picked pool equals the real backend's primary realized debit only in the common FULL-COVERAGE case. The mock's single-total-balance model cannot simulate split/fallback debits, so `spentAccountType` may differ from the real backend when a gen splits across pools; the mock also always stamps on success and cannot model the no-debit / field-omitted case. Treat it as an approximation, not a guarantee.

  Both new options are live-tunable via `setScenario()`. Backward-compatible: absent options preserve existing behavior; only the pick-aware `spentAccountType` change alters a default (and only when the block actually submits an `accountType`).

- 2809475: App Blocks **SHARED (app-global / cross-user) storage** — `useSharedStorage` + the `SHARED_*` message contract.

  - **`@civitai/app-sdk`**: adds the `SHARED_LIST / SHARED_GET_COUNT / SHARED_GET_COUNTS / SHARED_APPEND / SHARED_VOTE / SHARED_UNVOTE / SHARED_WITHDRAW` request/reply message types + the `SharedStorageValue` / `SharedStorageItemWire` types (the block↔host contract for the shared datastore). Publishing these is required for `@civitai/blocks-react`'s new hook types to resolve for consumers.
  - **`@civitai/blocks-react`**: new `useSharedStorage()` hook (`list` / `append` / `vote` / `unvote` / `withdraw` / `getCount` / `getCounts` over a per-app, cross-user store) + a `shared` scenario in `createMockHost` for local dev. Pairs with the civitai host bridge + server core.

## 0.18.0

### Minor Changes

- 2a507f3: `createMockHost` now answers `GET_BUZZ_BALANCE`, so `useBuzzBalance()` resolves against the mock host instead of hanging to the request timeout in local dev / tests. Adds an optional `buzzBalance?: { blue; green; yellow }` mock-host option (defaults to a plausible non-zero wallet) that the new `BUZZ_BALANCE_RESULT` reply carries — mirroring `createLiveHost`'s reply shape exactly. The mock succeeded-snapshot also stamps a synthetic `spentAccountType` (primary-funder) for parity with the real backend. Backward-compatible: absent option → the default wallet.

## 0.17.0

### Minor Changes

- a963b4d: `createLiveHost` (the `dev:live` real-backend proxy) now answers
  `GET_BUZZ_BALANCE` by calling the token-bound `blocks.getMyBuzzBalance` tRPC
  mutation (POST — the block JWT rides in the request body, not the URL) and
  replying with `BUZZ_BALANCE_RESULT` carrying the viewer's per-pool balance
  (`{ blue, green, yellow }`), or an `error` on failure. This closes the last
  `dev:live` gap for the per-account Buzz feature: `useBuzzBalance()` and the
  account-picker balance panel now work in local real-Buzz testing, matching the
  production host and the mock host. No new message types (they already ship in
  `@civitai/app-sdk`); `spentAccountType` already flows through the submit/poll
  snapshot passthrough unchanged.

## 0.16.0

### Minor Changes

- a7e43d3: App Blocks per-account Buzz (Phase 2 — SDK contract + hook). All additive and backward-compatible.

  `@civitai/app-sdk/blocks`:

  - New `BuzzAccountType` (`'blue' | 'green' | 'yellow'`) — the domain-clamped pools a block may spend from / read (no platform-internal `red`/`purple`).
  - Optional `WorkflowBody.accountType` — a _preference_ for which pool funds a generation; the host clamps it server-side. Rides through `useBuzzWorkflow().submit(body)` unchanged; omit for today's default funding order.
  - Optional `BlockWorkflowSnapshot.spentAccountType` — the primary funder (largest debit), which can be `blue`/free — populated by the host from the backend.
  - New `GET_BUZZ_BALANCE` (block→host) / `BUZZ_BALANCE_RESULT` (host→block) message pair to read the viewer's per-pool balance.

  `@civitai/blocks-react`:

  - New `useBuzzBalance()` hook — reads the viewer's `{ blue, green, yellow }` balance via the host bridge; fetches on mount, exposes `refetch`, `loading`, and `error`.

  Requires the civitai host to add a `GET_BUZZ_BALANCE` handler (Phase 3, parity-guard dependency) before the balance path works end-to-end.

### Patch Changes

- 04a591f: Add TSDoc (summary + `@example`) to the public API surface so usage surfaces in
  the editor exactly when an agent/dev writes the call.

  - `@civitai/blocks-react`: examples on every exported hook (`useBlockContext`,
    `useBlockResize`, `useBlockToken`, `useBlockSettings`, `useBuzzWorkflow`,
    `useBuzzPurchase`, `useAppStorage`, `useCheckpointPicker`, `useResourcePicker`,
    `useCivitaiNavigate`, `useRequestSignIn`, `useRequestConsent`,
    `useBlockAnalytics`) plus the `/ui` `Button` and `Modal` components. Examples
    mirror the README so docs and tag stay in sync.
  - `@civitai/app-sdk`: examples on the most-called exports — `defineBlock`, the
    OAuth functions (`generatePkce`, `buildAuthorizeUrl`, `exchangeCode`,
    `refreshToken`, `revokeToken`, `fetchMe`), the orchestrator helpers
    (`createOrchestratorClient`, `buildTextToImageBody`, `estimateWorkflow`,
    `submitWorkflow`, `getWorkflow`, `pollWorkflow`, `isTerminal`,
    `extractImageUrls`), and the scopes helpers (`hasScope`, `scopesFromBitmask`,
    `bitmaskFromScopes`, `getScopeLabel`).

  No runtime or API-shape changes — documentation only (now emitted into the
  shipped `.d.ts`). Also corrects a README OAuth example that read a non-existent
  `balance` field off `fetchMe`'s `unknown` return.

## 0.15.3

### Patch Changes

- 24363eb: dev:live picker: defer off-screen thumbnail loads with an IntersectionObserver scoped to the grid

  Native `loading="lazy"` does not defer images inside the picker's `overflow:auto` modal grid — the browser measures "near viewport" against the document viewport, and the whole modal sits within it, so all ~24 thumbnails fetched and decoded on open (the open-time main-thread freeze on real CDN images). The thumbnail `src` is now parked on `data-src` and promoted only when its card nears the grid's viewport (a +150px prefetch), via the same IntersectionObserver mechanism the infinite-scroll sentinel already uses. Guarded by a real-Chromium perf test (off-screen thumbnails stay deferred on open).

## 0.15.2

### Patch Changes

- 2b19d78: dev:live picker shows a labeled video tile for video-only models instead of a blank placeholder

## 0.15.1

### Patch Changes

- 76a8adb: docs: dev:live block token lifetime is now ~4h (was 15min)

## 0.15.0

### Minor Changes

- ad29d3b: dev:live picker paginates with infinite scroll (24/page, IntersectionObserver) instead of rendering 50 at once
- ad29d3b: dev:live picker no longer seeds a model card thumbnail from a VIDEO cover — picks the first IMAGE-type media instead (a video url in an <img> downloaded the full ~73 MB mp4 and rendered nothing; the edge transcode-to-jpeg trick doesn't defuse it). Video-only versions fall through to the neutral placeholder.

## 0.14.3

### Patch Changes

- 67c8c2e: dev:live picker grid no longer collapses its rows (align-content:start + grid-auto-rows:max-content) — fixes broken cards, missing thumbnails, and lag

## 0.14.2

### Patch Changes

- eed9cf8: dev:live picker lazy-loads thumbnails (no freeze) + scroll-bounds the grid + smaller page

## 0.14.1

### Patch Changes

- 49416ec: dev:live picker filters resources by family server-side instead of starving a single generic page

## 0.14.0

### Minor Changes

- 3086d68: dev:live live host now serves App-Storage KV + forwards SET_USER_CHECKPOINT against the real backend

## 0.13.2

### Patch Changes

- 56ad26c: fix(pickers): give resource/checkpoint picker requests a human-interactive timeout

  `useCheckpointPicker().open()` / `useResourcePicker().open()` used the default
  ~30s request timeout — but a picker waits for the USER to browse + choose, so a
  slow pick rejected mid-flow with "request OPEN\_\*\_PICKER timed out after 30000ms"
  and the selection was lost. They now use a generous 10-minute bound (the host
  still resolves earlier on pick/dismiss/close). Fake-timer regression test:
  advancing 60s no longer rejects the open() promise.

## 0.13.1

### Patch Changes

- 0826d32: fix(live host): bind the default fetch to globalThis

  `createLiveHost`'s default fetch was the bare `globalThis.fetch` reference;
  called detached it throws "Illegal invocation" in browsers (fetch is a
  DOM-bound builtin), which broke the catalog/picker overlay and every live-host
  network call when no `fetchImpl` was supplied. The default now wraps it so the
  call is always bound. Regression test asserts the global fetch is invoked with
  `this === globalThis`.

## 0.13.0

### Minor Changes

- b47ca66: Live host (`createLiveHost`, used by `dev:live`) now SERVES the resource pickers locally instead of stubbing them. On `OPEN_CHECKPOINT_PICKER` / `OPEN_RESOURCE_PICKER` it opens an in-harness catalog-browser overlay (real models fetched with the dev block token via `/api/v1/blocks/models`, public `/api/v1/models` fallback), the dev picks one, and the host replies with a real `BlockCheckpointInfo` / `BlockResourceInfo` in the exact shape the production host returns — so `useCheckpointPicker()` / `useResourcePicker()` are byte-identical in `dev:live` and in production (protocol fidelity, not chrome fidelity). Honors the request filters (`baseModelGroup`/ecosystem, `resourceType`, `currentVersionId` pre-highlight). A pick is discovery only — the server re-validates and prices every id at estimate/submit. Production is unchanged; this only fills in a local dev-host capability.

## 0.12.4

### Patch Changes

- 1f02b7b: Dev harness: restyle the fixed `DEV HARNESS` info strip to a minimal console / terminal aesthetic (dark terminal slab, monospace, subtle accent top border, dim chrome text with brighter accents on the live `viewer/consent/theme/outbound` values). Presentation-only — all content, the expand/collapse toggle, positioning, and pointer-events behavior are unchanged. This strip is shared chrome rendered by every block app's `dev:harness`.

## 0.12.3

### Patch Changes

- fe87382: fix(live host): surface read-only dev tokens instead of silently dead-ending

  A dev token minted from an OAuth login carries no `ai:write:budgeted` scope, so
  the block's `granted` is false and clicking Generate posts `REQUEST_CONSENT` —
  which `createLiveHost` previously swallowed as a silent no-op (live mode can't
  grant a scope the token lacks). Result: Generate did nothing, with no network,
  no console output, no error.

  Now the live host (1) logs a prominent, actionable warning at install when the
  token lacks the budgeted scope ("READ-ONLY … re-mint with `civitai login
--token <key>`"), and (2) logs a clear error on `REQUEST_CONSENT` instead of
  swallowing it. No protocol/API change — it can't grant the missing scope, but
  it no longer fails silently.

## 0.12.2

### Patch Changes

- 8989d94: Mock host: label the default synthetic generation result image as `MOCK`.

  When a block runs in `dev:harness` with no custom `generation.image(s)` configured, the mock host returns a `placehold.co` placeholder for the succeeded workflow. It previously showed only the last 4 chars of the workflow id, which looked like a real (or broken) result — a first-run developer who ran `civitai app create` → `npm run dev:harness` → Generate reported mistaking it for a real generation. The placeholder now prominently reads `MOCK` (with the short workflow id retained on a second line for per-gen uniqueness), so the scaffolded result is unmistakably a mock.

## 0.12.1

### Patch Changes

- 8113fd0: Alert: derive the ARIA live-region role from `color` instead of always using `role="alert"`.

  `error`/`warning` keep `role="alert"` (assertive, interrupts), while `info`/`success` now use `role="status"` (polite) so a static, always-present callout (e.g. a "How this works" panel on mount) is no longer announced assertively to screen-reader users. A new `role?` prop on `AlertProps` overrides the color-derived default (explicit value always wins). Backward-compatible for `error`/`warning`.

## 0.12.0

### Minor Changes

- 0554f63: feat(blocks-react): W6 component pack — `@civitai/blocks-react/ui` opinionated UI components

  Adds a zero-setup, Civitai-looking component pack to the `/ui` subexport so external App Block authors get coherent UI inside the iframe without a Mantine dependency or a CSS import step.

  - **Ten components**, each in its own file under `src/ui/`: `Button`, `TextInput`, `Textarea`, `Card`, `Stack`, `Group`, `Alert`, `Loader`, `Badge`, `Modal`. Each forwards `className` + `style` and a `ref` (where it wraps a DOM node), exports its TS props interface, and carries a `data-civitai-ui="<name>"` styling/test hook.
  - **Zero setup.** The pack ships its CSS as a TS string constant (`BLOCKS_UI_STYLES`) and injects it into the block document's `<head>` once, idempotently, the first time any component renders — the build is `tsc`-only (no bundler, no CSS pipeline), so there's nothing for the author to import or wire up. `injectBlocksStyles(doc?)` (manual/SSR) and the `useBlocksStyles()` hook are exported too.
  - **Auto-themed via your block's `data-theme`** (gotcha #60). Tokens are CSS custom properties (`--ci-*`) under `:root`, flipped by `[data-theme='dark']`; no attribute = light, matching the starter palette. The host can't reach across the iframe, so the block sets `data-theme={theme}` on its own root and the pack reads the ancestor selector.
  - **Accessibility baked in:** inputs link label/description/error via `htmlFor` + `aria-describedby` + `aria-invalid`; `Alert` is `role="alert"`; `Loader` is `role="status"`; `Modal` is `role="dialog"` + `aria-modal`, closes on Escape and overlay click, focuses its panel on open and restores focus on close. (Modal does not trap focus in v0 — a documented v1 follow-up.)

  `SettingsForm` is unchanged (it intentionally keeps its unstyled-native contract and is host-themed; migrating it to the pack is a separate change). No new runtime dependencies. 92 new behavior-driven tests.

## 0.11.2

### Patch Changes

- 735b08f: fix(testing): `createLiveHost` no longer turns a transient poll transport error into a terminal `failed` workflow.

  `dev:live` polls a workflow via the `blocks.pollWorkflow` tRPC mutation. Previously, ANY non-2xx response or network throw on a poll (a not-yet-rolled-out backend pod 401ing for a few seconds, a momentary network hiccup, a 5xx blip) was fabricated into a terminal `WORKFLOW_STATUS` snapshot with `status: 'failed'` — so a generation that succeeded server-side showed as FAILED in the block and the poll loop stopped. The round-5 dogfood hit exactly this (its success needed manual retries past bad pods).

  The poll path now distinguishes a transport/infra blip from a genuine workflow failure: a real workflow failure is a 200 response whose snapshot is `status: 'failed'` (forwarded as-is, terminal), whereas any non-2xx / network throw is a transport error. Transport errors are retried with bounded exponential backoff (up to 4 attempts, ~1.75s worst case). If the backend stays unreachable after the retries, the host replies with a NON-terminal `processing` snapshot carrying the transient error (so the block's own poll loop keeps polling and the real outcome can still surface) — never a synthesized terminal `failed`. `ESTIMATE`/`SUBMIT`/`CANCEL` behavior is unchanged.

## 0.11.1

### Patch Changes

- f20d590: docs: repoint the dead `developer.civitai.com/docs/blocks` README link

  The dev portal has no App Blocks section, so the intro link returned 404. Point
  it at the real, public "Build your first App Block" guide in this repo instead.

## 0.11.0

### Minor Changes

- c8d928c: feat(testing): add `createLiveHost` — the LIVE sibling of `createMockHost`. Where the mock host synthesizes every reply with no network, `createLiveHost` FORWARDS the App-Block postMessage protocol to the REAL Civitai backend using a short-lived, pasted dev block token (minted via `POST /api/v1/blocks/dev-token`), so a harness's `dev:live` mode runs local block code against real compute / real Buzz / the real catalog (Phase 2 of the dev-token live-mode design).

  It returns the same `{ install, setScenario, buzz }` interface as `createMockHost` (so a harness can swap them; `setScenario`/`buzz` are inert in live mode). On install it decodes the token JWT payload (no signature verification) to seed `BLOCK_INIT`, fetches the viewer via `GET /api/v1/blocks/me`, and forwards `ESTIMATE/SUBMIT/POLL/CANCEL_WORKFLOW` to the corresponding `blocks.*` tRPC mutations (Bearer = block token), mapping `BlockWorkflowSnapshot` back to the right reply keyed by `requestId`. Backend/network errors map to a failed-shape snapshot (never a hung promise). `OPEN_BUZZ_PURCHASE` deep-links to the real purchase page and replies `purchased: false` (honest — the out-of-band purchase isn't observable). Pickers / `SET_USER_CHECKPOINT` / the app-storage KV protocol reply with a clearly-labelled "not supported in live v1" outcome. Accepts an injectable `fetchImpl` for tests.

  Exported from `@civitai/blocks-react/testing` as `createLiveHost`, `decodeBlockTokenPayload`, and the `LiveHostOptions` type.

## 0.10.1

### Patch Changes

- f87da00: fix(testing): the dev `Harness` log badge no longer overlaps or intercepts the block's own bottom content. The fixed bottom-right badge now reserves matching bottom padding on the harness frame and is `pointer-events: none` (re-enabled only on the summary/log), so clicks on a block's last row of controls (e.g. action buttons) land on the controls instead of the badge.

## 0.10.0

### Minor Changes

- 216f3ca: `createMockHost`: rich, configurable scenario controls for local-dev DX (Layer 1).

  The mock host now lets a block dev exercise the full money / error / storage UX
  locally — synthetically, with no real Buzz and no network. All additions are
  optional and backward-compatible (existing `createMockHost({ viewer })` calls and
  the legacy `cost` / `failMode` / `buzzBudget` / `pollsUntilDone` knobs are
  unchanged).

  - **`generation`** scenario: `costPerGen` (number or `(body) => number`),
    `latencyMs` (number or `[min, max]`), `failRate` (0..1), `failNext` (fail the
    next N submits), and `image` / `images` (custom result URLs). Simulate real
    costs, slow gens, and failures.
  - **`buzz`** scenario: `balance` (a simulated spendable wallet — a gen that would
    exceed it returns an insufficient-Buzz outcome; successes debit it; a top-up
    refills it) and `insufficient` (force the insufficient path). Exercise the
    top-up / insufficient UX.
  - **`storage`** scenario + a working in-memory KV backend: the mock host now
    answers the full `APP_STORAGE_*` protocol (`get` / `set` / `delete` / `list`
    with cursor pagination / `getQuota`), with `seed`, `quotaBytes`,
    `valueCapBytes`, and `failNext` knobs. W4 KV apps (e.g. Prompt Library) can
    test load / quota / error states against `createMockHost` directly instead of
    hand-injecting a fake store.
  - **Runtime handle**: `createMockHost(...)` now returns `setScenario(patch)` plus
    a `buzz` handle (`getBalance()` / `setBalance(n)`) so a harness UI can flip
    scenarios mid-session.
  - `readMockHostUrlOptions` maps new query params onto the scenarios:
    `?balance`, `?insufficient`, `?latency` (`2000` or `500-2000`), `?costPerGen`,
    `?failNext`, `?failRate`, `?seed=<json>`.

  The mock host remains pure + synthetic (a test asserts the full protocol never
  calls `fetch`).

## 0.9.0

### Minor Changes

- 37d8465: Add `useDomainMaturity()` and `<SfwGate>` for reading the surrounding
  color-domain's maturity ceiling. `useDomainMaturity()` returns
  `{ domain, maxBrowsingLevel, isSfw, isLevelAllowed(level) }` from the same init
  state as `useBlockContext`, deriving `isSfw` from the `maxBrowsingLevel` bitmask
  (host PR #2670) and **failing closed to SFW** before `BLOCK_INIT` / when the host
  omits the field. `<SfwGate>` renders its children only when the domain is SFW (or
  when a given `level` is allowed), else an optional `fallback`. `createMockHost`
  now emits `domain`/`maxBrowsingLevel` on `BLOCK_INIT` (driven by `domain`,
  `maxBrowsingLevel`, or a `maturity: 'sfw'|'mature'` convenience) so the hook and
  gate are exercisable in tests and the dev harness. Additive only; forward-
  compatible (works before #2670 deploys). Requires `@civitai/app-sdk` >=0.13.0
  (for `isSfwCeiling`/`isLevelAllowed`/`ColorDomain` and the `browsingLevel`
  constants); the peer-dependency constraint is bumped accordingly.

## 0.8.0

### Minor Changes

- eca1252: Add `createMockHost()` + a React `<Harness>` (a.k.a. `<MockHostProvider>`) to the `@civitai/blocks-react/testing` subpath.

  `createMockHost()` is a framework-agnostic, test-and-dev-only fake of the civitai.com embedding host. It patches `window.parent.postMessage`, dispatches a configurable `BLOCK_INIT`, and answers the full block protocol — `REQUEST_TOKEN`, the lazy-consent `REQUEST_CONSENT` → `TOKEN_REFRESH` round-trip, `ESTIMATE_WORKFLOW`, `SUBMIT_WORKFLOW`, `POLL_WORKFLOW` (processing ×N → succeeded with image + cost), `OPEN_BUZZ_PURCHASE`, `OPEN_CHECKPOINT_PICKER`, and `OPEN_RESOURCE_PICKER` (canned picks). It is driven by an options object (`viewer`, `consentGranted`, `failMode`, `cannedPicks`, `pollsUntilDone`, `cost`, `theme`, `context`, + forward-compat `domain`/`maturity`) and also honors the dev URL toggles (`?viewer/?consent/?fail/?theme/?pick/?pickCkpt`). It returns an `{ install(): uninstall }` handle so it works from node/jsdom/happy-dom tests as well as a browser dev harness.

  `<Harness>` is a thin React wrapper that installs the mock host on mount (cleanup on unmount) and optionally renders the on-screen message-log panel.

  This replaces the ~250-line hand-rolled per-block harness. Test/dev-only — no change to the block runtime API or money/transport semantics. The existing `resetTransport` / `mockParentMessage` testing exports are unchanged.

## 0.7.0

### Minor Changes

- 6ba78fa: Add the PAGE resource picker (Design 1 — host-chrome): `useResourcePicker()` +
  the `OPEN_RESOURCE_PICKER` / `RESOURCE_PICKER_RESULT` message pair.

  This generalizes the existing model-slot `OPEN_CHECKPOINT_PICKER` /
  `useCheckpointPicker` flow to App Block PAGES, and widens it from Checkpoint-only
  to a typed allowlist — v1 accepts `'Checkpoint' | 'LORA'` only
  (`BlockResourcePickerType`). The block asks the host to open its OWN native
  resource modal as host chrome; the user searches in host chrome (NOT the iframe);
  the host returns ONLY the single chosen resource as the narrow `BlockResourceInfo`
  (`{ versionId, modelId, baseModel, modelType }`). The iframe never receives the
  catalog, a list, or any resource it didn't pick.

  `@civitai/app-sdk` additions: `BlockResourceInfo`, `BlockResourcePickerType`, and
  the two message variants. `@civitai/blocks-react` adds `useResourcePicker()`
  whose `open({ resourceType, baseModelGroup? })` resolves with the chosen
  `BlockResourceInfo` or `null` when the user dismissed.

  Discovery only: the returned `versionId` is a hint, never an entitlement — feed
  it into `body.modelVersionId` (Checkpoint) or `body.additionalResources` (LoRA)
  and the host re-validates every id server-side at estimate/submit (the page gate

  - orchestrator belt). Purely additive and backward-compatible. The host side
    ships in civitai/civitai (`PageBlockHost` `OPEN_RESOURCE_PICKER` handler); a block
    can consume this hook once a version of these packages is published.

## 0.6.0

### Minor Changes

- Add `useRequestSignIn()` — anonymous conversion. Returns
  `requestSignIn(payload?)`, a fire-and-forget helper that posts the new
  `REQUEST_SIGN_IN` message (`{ returnUrl?: string }`) through the active
  transport. A block rendered for a logged-out viewer (`viewer === null`) calls
  it when the user clicks an action that needs auth/money (e.g. Generate) so the
  host starts civitai.com's login flow. Pairs with `@civitai/app-sdk@^0.9`.

- Add `useRequestConsent()` — lazy consent. Returns `requestConsent(payload?)`,
  a fire-and-forget helper mirroring `useRequestSignIn()` that posts the new
  `REQUEST_CONSENT` message (`{ scopes?: string[] }`). A block rendered for a
  logged-in viewer whose token is missing a consent-gated scope calls it on the
  gated action (instead of prompting on load); the host opens its consent UI and,
  on grant, re-mints and pushes a `TOKEN_REFRESH` with the now-granted scopes so
  the block can retry.

- Suffix-wildcard support in the `IframeTransport` origin allowlist (new
  `internal/originMatcher`). The allowed-parent-origin list now accepts entries
  like `https://*.civitai.com`: a bare host still matches exactly; a `*.` prefix
  matches any subdomain of the suffix (never the apex unless listed separately,
  never a different registrable domain). Lets a block be embedded under
  preview/canary hosts without enumerating every one.

- Fix `peerDependencies["@civitai/app-sdk"]`: widened from `^0.7.0` (which
  excluded the `0.8.x`/`0.9.x` it is actually used with) to `>=0.7.0 <1`, so
  installing the current `@civitai/blocks-react` alongside the current
  `@civitai/app-sdk` no longer emits an unmet-peer-dependency warning.

## 0.4.2

### Patch Changes

- `useBuzzWorkflow` now gives the orchestrator-bound requests (`estimate` / `submit` / `poll`) a 120s timeout instead of the transport's 30s `DEFAULT_REQUEST_TIMEOUT_MS`. `submit` does a whatif cost-preflight + the real submit (two orchestrator round-trips) plus a prompt audit server-side, which legitimately exceeds 30s on a busy generation queue — the old default surfaced that as a spurious `request "SUBMIT_WORKFLOW" timed out after 30000ms` rejection even though the submit was healthy.

## 0.4.1

### Patch Changes

- Republish to fix `workspace:^` protocol leaking into `peerDependencies."@civitai/app-sdk"` of the 0.4.0 tarball — npm consumers got `EUNSUPPORTEDPROTOCOL` on install. Replaced with explicit `^0.6.0` semver.

## 0.4.0

### Minor Changes

- Initial public release of `@civitai/blocks-react` (0.4.0 — pre-1.0 v0): React hooks and iframe transport for Civitai App Blocks. Pairs with `@civitai/app-sdk/blocks` (the framework-agnostic contract) so block apps don't need to wire `postMessage` themselves.

  **Transport**

  - `IframeTransport` — origin-validated `postMessage` transport. Awaits `BLOCK_INIT` with a 10s timeout, queues outbound messages until init lands, correlates request/response by `requestId`, and auto-sends `BLOCK_READY` after applying init so the platform's 10s ready timeout doesn't fire on blocks that never explicitly send one (`useBlockResize` follows with real height measurements). Refuses to mount without at least one allowed parent origin. Every inbound payload passes a shape-validation gate (`payloadValidatorFor`) before reaching state-mutating code: malformed messages drop with `console.warn` instead of clobbering the token snapshot or producing `Invalid Date`. Handles both host-pushed `TOKEN_REFRESH` (no `requestId`) and `TOKEN_REFRESH_RESPONSE` (optional `requestId`); both replace the full wrapped token — scopes and `buzzBudget` included — not just `raw`/`expiresAt`.
  - `InlineTransport` — v2 stub. Reads `window.__CIVITAI_BLOCK_CONTEXT__`; not wired in v1.
  - `BlockTransportDetector.detect()` — picks iframe vs inline based on bootstrap presence; reads the allowlist from `VITE_` / `NEXT_PUBLIC_` / `PUBLIC_` env vars.
  - `getTransport()` — process-wide singleton so hooks share one instance.

  **Hooks**

  - `useBlockContext` — primary; returns the host-provided context, viewer (`ViewerInfo | null` — `null` for anonymous), theme (`'light' | 'dark'`), `appId`, `blockId`, `blockInstanceId`, and a `ready` gate.
  - `useBlockSettings`, `useBlockToken` (with `refresh()` for 401 retries and in-flight dedup so the scheduled and synchronous refresh paths never fan out duplicate `REQUEST_TOKEN` messages), `useBuzzWorkflow` (estimate/submit/poll with a shared terminal-status set so a host-returned `canceled` / `expired` snapshot exits `polling` correctly), `useBlockResize` (ResizeObserver → `RESIZE_IFRAME`), `useBuzzPurchase`, `useCivitaiNavigate`, `useBlockAnalytics`, `useCheckpointPicker`.

- Manifest-driven settings (W3 v0): `@civitai/blocks-react/ui` `SettingsForm` headless component. Renders a typed form from a `ManifestSettings` declaration, filters fields by scope + `requires_scope`, surfaces inline server-side validation errors, and delegates `resource_picker` widgets to the host via the existing `useCheckpointPicker` bridge.

- App Storage KV substrate (W4 v0): `useAppStorage()` hook with `get`, `set`, `delete`, `list`, `getQuota`. Anon viewers get a clean null on `get` + a thrown `UNAUTHORIZED` on `set`. Server-side enforces 50MB per-app quota and 64KB per-value cap. Pairs with the platform's per-app PostgreSQL schema (one schema per approved app block, isolated by a NOLOGIN role).

  Tracks `BlockInitPayload` and the postMessage protocol from civitai/civitai's `src/components/AppBlocks/types.ts` / `IframeHost.tsx` — viewer/theme/`appId` field layout and the wrapped-token shape match the platform contract.

  Peer-depends on `react ^18 || ^19` and `@civitai/app-sdk ^0.6`. Test surface covers origin validation, the 10s init timeout, requestId correlation, payload shape validation at the trust boundary (rejecting malformed `BLOCK_INIT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE` / workflow replies), host-pushed token refresh, auto-`BLOCK_READY`, token-refresh scheduling + snapshot updates, the workflow state machine, the `SettingsForm` field rendering + validation, and the `useAppStorage` request/response cycle.
