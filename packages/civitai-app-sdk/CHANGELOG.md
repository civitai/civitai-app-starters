# @civitai/app-sdk

## 0.34.0

### Minor Changes

- b797751: `IMAGE_GEN_ENGINES`: add `qwen` — the orchestrator accepts it and the catalog did not list it.

  `IMAGE_GEN_ENGINES` is a hand-maintained mirror of `components.schemas.ImageGenInput.discriminator.mapping` in `https://orchestration.civitai.com/openapi/v2-consumers.json`. That mapping is the defining surface for the `engine` field of an `imageGen` step, and it moves per orchestrator build — so the catalog drifts behind it without anyone touching this repo.

  It had drifted by exactly one entry. Re-reading the live mapping gives **12** keys; the catalog listed **11**, missing **`qwen`**:

  `comfy`, `fal`, `flux1-kontext`, `flux2`, `gemini`, `google`, `grok`, `openai`, **`qwen`**, `sdcpp`, `seedream`, `wan`

  `qwen` maps to `QwenApiImageGenInput` — Qwen image models hosted by Alibaba Model Studio (DashScope), distinct from running Qwen-Image on our own workers via `sdcpp`. It is now in the catalog with that description. The full mapping was diffed in both directions: nothing else was missing, and nothing listed has been withdrawn. `WORKFLOW_STEP_TYPES` was re-checked in the same pass and is unchanged at exactly the spec's 44.

  **Why `minor`.** `ImageGenEngine` is `keyof typeof IMAGE_GEN_ENGINES`, so this widens that union — purely additive. Nothing that compiled before stops compiling; `engine` was already accepted as a pass-through field, so this is a typing and discoverability fix rather than a new capability. No runtime behaviour change.

  The transcribed fixture (`test/fixtures/orchestrator-spec-catalogs.json`) and the pinned expectation count in `test/orchestrator.test.ts` were updated in lockstep, which is what keeps the offline unit test and the live drift-check pinned to each other.

### Patch Changes

- 690eeb2: Docs: stop the `imageGen` row of the step-type/builder table in the shipped
  `README.md` from carrying a hand-maintained engine list, and fix its
  characterisation.

  The row read:

  > Closed-source image-gen APIs — Nano Banana, Gemini, GPT-Image, Flux.1 Kontext,
  > Flux.2, Seedream, Grok, fal. `IMAGE_GEN_ENGINES` lists the engines.

  Two things were false. **The list was incomplete** — the live catalog has 12
  engines (`comfy`, `fal`, `flux1-kontext`, `flux2`, `gemini`, `google`, `grok`,
  `openai`, `qwen`, `sdcpp`, `seedream`, `wan`, per
  `components.schemas.ImageGenInput.discriminator.mapping`), the prose named
  roughly 8, and it was already non-exhaustive before `qwen` existed. **The
  characterisation was wrong** — `sdcpp` is `SDCpp (self-hosted diffusion)` and
  `comfy` is a Comfy graph run as an engine, neither of which is a closed-source
  third-party API.

  🔴 **The fix is deliberately NOT to make the list exhaustive.** An exhaustive
  prose list would be a third hand-maintained copy of an enumeration that already
  has a source of truth (`IMAGE_GEN_ENGINES`) and a CI drift-gate
  (`pnpm check:catalogs`, which pins the catalog to the live orchestrator spec).
  It would rot on the very next upstream engine addition and nothing would catch
  it — the drift-check reads the catalog, not the README. That is exactly the
  class that added `qwen` to the catalog while leaving this row stale.

  So the row is now explicitly illustrative (`e.g.`), names `IMAGE_GEN_ENGINES` as
  the authority, and says in-line that it is not exhaustive — a claim that stays
  true however the catalog grows.

## 0.33.0

### Minor Changes

- acea1ff: Add the `CONSENT_UNAVAILABLE` host→block push, and make both dev hosts emit it.

  The host now tells a block when a `REQUEST_CONSENT` can NEVER be granted
  (civitai/civitai #3733): the scope was clamped or withheld at mint, so no
  consent round-trip in that environment will ever add it. Until this release the
  SDK had no such message, so the signal was un-consumable by a typed block — the
  host posted it and nothing on the block side could branch on it, leaving the
  developer-visible bug it was meant to fix exactly where it was: an app's own UI
  saying "Confirm in the Civitai dialog. If you dismissed it, click Generate
  again" next to a host toast saying the permission is unavailable. Two
  contradictory messages on one screen, and the misleading one is where the
  developer is looking.

  `@civitai/app-sdk`

  - New `CONSENT_UNAVAILABLE` variant on `ParentToBlockMessage` carrying
    `{ reason, scopes }`, plus the exported `ConsentUnavailablePayload` /
    `ConsentUnavailableReason` types. Host-INITIATED with no `requestId` —
    documented and shaped like `TOKEN_REFRESH` / `THEME_CHANGE`, deliberately NOT
    a `*_RESULT` reply, because `REQUEST_CONSENT` carries nothing to correlate one
    against.
  - 🔴 **`scopes` can legitimately be `[]`.** The host decides to refuse on its own
    UNFILTERED un-grantable set, then filters the names it puts on the wire to the
    known block-scope vocabulary — the request's `scopes` hint is untrusted block
    input and this payload is rendered by block UI. A request naming nothing the
    platform recognises therefore produces a real refusal carrying `scopes: []`.
    The refusal is the signal; the names are advisory. A consumer that branches on
    `scopes.length > 0` silently drops the message it subscribed for.

  `@civitai/blocks-react`

  - **New `useConsentUnavailable()` hook** — the typed consumption path, following
    the house pattern for an unsolicited host push. It returns
    `{ refusal, reset }`, where `refusal` is a `ConsentUnavailablePayload | null`.
    Without it the only public route was
    `getTransport().onMessage('CONSENT_UNAVAILABLE', (p: unknown) => …)` plus a
    hand-written `as ConsentUnavailablePayload` cast — an UNCHECKED cast, so the
    message was _nameable_ but not safely _consumable_, and a payload shape change
    would compile straight through it in every block. The hook stores the payload
    unconditionally (no `scopes.length` gate — see above) and unsubscribes on
    unmount. `ConsentUnavailablePayload` is re-exported here so a React consumer
    needs only one import.
  - 🔴 **A refusal is BUFFERED across mounts, so one that arrives while no
    consumer is mounted is not dropped.** The transport hands an unsolicited push
    only to handlers registered at the instant it arrives, so a refusal that landed
    before `useConsentUnavailable()` mounted — the requester and the consumer being
    different components, or the consumer conditionally rendered — was gone, and a
    dropped refusal puts back the two-message screen this change exists to remove.
    `requestConsent()` arms the buffer as it sends (a refusal can only follow a
    request), and a mounting hook seeds from it. The buffer holds at most the
    latest refusal, is discarded once the block token changes — a refusal is a
    claim about _that_ token's scopes, and the grant path re-mints — and is cleared
    by `reset()`, so the documented "Try again" button is not undone by the next
    mount. A `REQUEST_CONSENT` posted through the raw transport does not arm it.
  - 🔴 **The push is UNCORRELATED and stays that way.** `REQUEST_CONSENT` carries
    no `requestId`, so every mounted `useConsentUnavailable()` observes every
    refusal and there is no reliable filter — `scopes` is advisory and may
    legitimately be `[]`, so it cannot serve as a correlation key. Blocks with two
    independent requesters should keep a request and its refusal UI in one
    component. Now stated on the hook and in the README.
  - 🔴 **`requestConsent()` MUST be called with `scopes` CONTAINING A REAL SCOPE
    NAME for a refusal to arrive.** The argument is optional in the signature and
    genuinely optional for the GRANT path, but `resolveUngrantableConsentNotice`
    returns "no notice" unless the hint is an array holding at least one non-empty
    string — `undefined`, a non-array, `[]`, `['']` and `[1, 2]` all produce
    silence, in the real host and in both dev hosts. So even
    `requestConsent({ scopes: [] })` gets nothing back. Earlier drafts of this doc
    said "absent or not an array", which is narrower than the code. Now documented
    accurately on the hook, in `useRequestConsent`'s docstring, and in the README.
  - The dev `<Harness>` consent readout is now THREE-state
    (`granted` / `withheld` / `ungrantable`, plus `granted+ungrantable`). It was a
    boolean derived from `consentGranted` alone, so `?consent=ungrantable` — which
    leaves that flag undefined — rendered **withheld**, i.e. _"not granted yet,
    try again"_: the exact message this whole change exists to replace, shown next
    to a block correctly reporting the refusal.
  - `isValidConsentUnavailable` + its `payloadValidatorFor` entry. The mapping is
    the load-bearing half — that switch's `default:` arm returns `null` (a
    STRUCTURAL PASS), so a guard written without the case leaves the push
    unvalidated at the trust boundary. The guard deliberately ACCEPTS an empty
    `scopes` array; written the obvious way ("a non-empty array of strings") it
    would silently drop the exact message described above.
  - **Both dev hosts now emit it**, so a refusal handler is reachable in
    `pnpm dev` / `pnpm dev:live` instead of only in production — the same
    untestable-locally gap that let the original bug ship and survive.
    `createMockHost` gains `consentGrantable` (default `true`, so existing
    behaviour is unchanged); set it `false`, flip it live with
    `setScenario({ consentGrantable: false })`, or use `?consent=ungrantable` in
    the harness URL. `createLiveHost` — which can grant nothing, ever — now posts
    the refusal alongside its existing console warning.
  - Both hosts route through ONE shared decision that mirrors the real host's
    `resolveUngrantableConsentNotice`, so dev and production cannot drift on when
    the refusal fires or what it names. The benign case (a block re-requesting a
    scope it already holds) stays silent in both channels: a permission-unavailable
    state rendered over a permission that works is worse than saying nothing.

  Back-compat, both directions — purely additive. An older SDK has no branch for
  the message and falls through the transport's no-op tail, so deployed blocks are
  unaffected; a newer block against a host that never sends it just never sees a
  refusal, which is today's behaviour. Nothing awaits the message, so there is no
  timeout to hit.

## 0.32.0

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

- 31f5c55: Make `WorkflowBodyCustomComfy` a discriminated union on `mode`, and delete the false "the iframe never sends a graph" claim.

  The host has shipped an INLINE-GRAPH arm of `customComfy` (`mode: 'inline'`) — a block can ship the ComfyUI graph itself instead of naming a server-registered recipe. The SDK's type did not have it, and worse, its doc comment asserted the opposite: "there is no way for a block to run an arbitrary/unreviewed graph". That sentence was written when it was true and was never revisited. In a blind dogfood a developer working against the live feature read it, believed it over their own instinct, and concluded the capability did not exist.

  `WorkflowBodyCustomComfy` is now `WorkflowBodyCustomComfyRecipe | WorkflowBodyCustomComfyInline`, mirroring the host's `blockCustomComfyMemberSchema`:

  - `WorkflowBodyCustomComfyRecipe` — the existing shape, unchanged except that `mode` is now an OPTIONAL `'recipe'` literal. A body that omits `mode` still lands here, so every deployed block and every body written against an earlier SDK is byte-identical and keeps working. (The host declares it `.optional()` and specifically NOT `.default()` for this reason.)
  - `WorkflowBodyCustomComfyInline` — `{ kind, mode: 'inline', workflow, resources, prompt?, negativePrompt?, maxBuzz }`, matching the host's `.strict()` `blockInlineComfyBodySchema` field-for-field. `InlineComfyNode` (`{ class_type, inputs }`) is exported alongside it.

  The new doc comments describe what is actually enforced: the arm is developer-only and page-token-only; code review is replaced by three fail-closed server gates (AIR containment over the declared `resources`, an entitlement belt stricter than the onsite generator, and a moderation sweep over every string leaf in the graph); and `maxBuzz` is documented as what it really is — the host stamps `stepTimeoutSeconds = maxBuzz`, so it is simultaneously the Buzz ceiling and the step timeout in seconds, and setting it low to be thrifty buys a silently `expired` job rather than a cheap one.

  The package README's type inventory now lists the new exports and explains the two arms, so the shipped npm page describes the same contract the types do — including that the inline arm is developer-only and page-token-only, and that a registered recipe is still how a graph reaches every viewer.

  Wire parity is pinned against the HOST'S OWN fixtures rather than against our mental model of them: `test/blocks/inline-comfy-wire-parity.test-d.ts` transcribes the payloads from civitai's `workflow.schema.inline-comfy.test.ts` and asserts each body the host ACCEPTS satisfies these types, each field the host `.strict()`-REJECTS (`sessionOwnerApiToken`, `comfyImage`, `minVramGb`, `sessionId`, `useSageAttention`, `minimumDurationSeconds`, `trace`) stays unassignable, and the mode-less recipe body every deployed block sends still type-checks.

  Additive for producers; narrowing for consumers that read `customComfy` fields without a second narrow on `mode` — which is the union doing its job. `@civitai/blocks-react`'s mockHost `preferredAccountType` is fixed accordingly (an inline body has no `params.accountType`; it resolves to Auto host-side, so `undefined` is the accurate answer). No runtime behaviour changes in either package.

- 0693c89: Pin `WORKFLOW_STEP_TYPES` / `IMAGE_GEN_ENGINES` to the orchestrator spec — and remove a phantom step type that never existed.

  `WORKFLOW_STEP_TYPES` advertises itself as "every workflow step type the orchestrator accepts". It was not. Measured against the `WorkflowStepTemplate` discriminator mapping in `https://orchestration.civitai.com/openapi/v2-consumers.json` (the submit-side union — the defining surface, not a sample of schema names):

  - **`audioMix` did not exist.** It appears **0 times** in the spec. An author who found it in the catalog or took it from autocomplete and submitted `{ $type: 'audioMix' }` got a 400 with nothing in the SDK to explain why. The real step is **`composeMedia`**, which composes an ordered element list into either an audio mixdown or a video composition (its output is discriminated on `type`). It is now in the catalog with that description and a note pointing at it from where `audioMix` used to be.
  - **10 real step types were missing**: `customComfy`, `composeMedia`, `imageBackgroundRemoval`, `imageToSvg`, `videoBackgroundRemoval`, `polyGen`, `model3DPreview`, `training`, `shieldstralModeration`, plus `comfyNodepackSnapshot` / `qwenImageBench` (both labelled as platform internals — they are in the consumer spec, but a third-party app has no reason to submit one).

  The catalog is now exactly the spec's 44 entries, and `IMAGE_GEN_ENGINES` is confirmed exactly its 11.

  **How it stays that way.** The old guard was `expect(keys).toContain('textToImage')` over 7 of the then-34 names — a spot-check that cannot express either half of a drift, and did not catch either half of this one. It is replaced by two checks that together pin the catalogs to the live spec:

  - `test/orchestrator.test.ts` compares the catalogs to lists **transcribed from the spec** into `test/fixtures/orchestrator-spec-catalogs.json` — exact set equality plus separately-named phantom / missing assertions, a non-blank-description check, and a positive control asserting the expectation itself is non-empty (every other assertion in that block passes vacuously against an empty fixture).
  - `pnpm check:catalogs` (`scripts/check-orchestrator-catalogs.mjs`, wired into CI as an advisory job alongside the existing schema-drift check) re-fetches the **live** spec and diffs the fixture against it, reporting STALE and MISSING separately. An unreachable spec, a missing discriminator, or an empty mapping all FAIL — a drift check that skips reads exactly like one that passes.

  Neither alone is sufficient: the unit test cannot see the orchestrator shipping a new step type, and the script does not read the SDK source at all.

  **Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so dropping `audioMix` removes it from that union. Assignment sites are unaffected (`BuildWorkflowBodyStep.$type` is `WorkflowStepType | (string & {})` and always was), but an explicit `const t: WorkflowStepType = 'audioMix'` stops compiling — which is the correct outcome, since that value was never submittable.

  No runtime behaviour changes. The block-facing `@civitai/app-sdk/blocks` surface (`WorkflowBody` and friends) is untouched.

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

## 0.31.0

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

## 0.30.0

### Minor Changes

- ce1404f: Add the `kind: 'step'` arm to `WorkflowBody`.

  The host has shipped a step bridge — a code-reviewed, non-DB-editable registry of
  orchestrator step types that a block can submit through `useBuzzWorkflow()` — but
  the SDK's public wire type stopped at `textToImage` and `customComfy`, so there
  was no typed client for it. This adds the missing member.

  `WorkflowBodyStep` mirrors the host's `blockStepBodySchema` exactly:
  `{ kind: 'step'; step: string; params: Record<string, unknown> }` and nothing
  else, because that schema is `.strict()` and rejects any additional field rather
  than dropping it. `step` is a registered step id resolved server-side against the
  registry (an unregistered id is rejected fail-closed at the wire schema);
  `params` are bounded and validated per-step by that entry's own `.strict()`
  schema, which is why they are deliberately opaque here rather than mirrored — a
  hand-copied param type in this package would drift against the authority
  silently.

  Additive for producers: every existing `WorkflowBody` still satisfies the union
  unchanged. Consumers that `switch` exhaustively over `body.kind` will get a
  compile error pointing at the new member, which is the intended behaviour.

## 0.29.0

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

- ce7611e: Add the App Blocks Batch-D block↔host messages: `SHARED_GET` / `SHARED_GET_RESULT`, `SHARED_REPORT` / `SHARED_REPORT_RESULT`, and `SAVE_IMAGE` / `SAVE_IMAGE_RESULT`, plus an additive `viewerVoted?: boolean` on `SharedStorageItemWire`.

  - **`SHARED_GET { key }` → `SHARED_GET_RESULT { item: SharedStorageItemWire | null }`** — single-row fetch-by-key, the companion to `SHARED_LIST`'s paged read so a `?g=<key>` deep-link to an item past the first page resolves. A missing / moderator-hidden row comes back as `item: null` (never leaked). The item carries the same shape as one list item, including `count` + `viewerVoted`.
  - **`SHARED_REPORT { key, reason? }` → `SHARED_REPORT_RESULT { ok, error? }`** — report a posted shared-board entry for moderator review (the `apps.shared.report` server procedure already existed; this is the postMessage seam). Same `{ ok, error? }` reply convention as `SHARED_WITHDRAW_RESULT` (the error path carries `ok: false`).
  - **`SAVE_IMAGE` → `SAVE_IMAGE_RESULT { ok, error? }`** — ask the host to DOWNLOAD an image the block already displays (a sandboxed opaque-origin block has no `allow-downloads`, so it can otherwise only copy a URL). Two mutually-exclusive variants: `{ url }` for the block's own output (origin-allowlisted host-side to the civitai image/blob CDN — never an arbitrary host) and `{ imageId }` for a cross-user grid image (routed through the same per-viewer gated read as `GET_IMAGES_BY_IDS`, so a withheld image can't be saved). Optional `filename` (host-sanitized).
  - **`SharedStorageItemWire.viewerVoted`** is OPTIONAL on the wire so a host that predates it still typechecks; consumers default a missing value to `false`.

  All additive — old blocks never send the new messages, and the new field is optional. Host handlers land ahead of this publish (the host↔SDK parity gate is one-directional).

- d52e50d: Add `WorkflowBodyTextToImage.sourceImages?: BlockSourceImage[]` — multi-image conditioning for App Blocks generations — and deprecate the singular `sourceImage`.

  Mirrors civitai/civitai's `blockTextToImageBodySchema.sourceImages` (`z.array(blockSourceImageSchema).min(1).max(BLOCK_SOURCE_IMAGES_WIRE_MAX)`). The element type is unchanged (`{ url, width, height }`, all required), so an existing `sourceImage` value drops straight into a 1-element array.

  - **`sourceImage` stays, deprecated.** It is a permanent alias — every deployed block and the published developer docs ship it, and the server normalizes it into a 1-element array so both forms produce a byte-identical generation. Only the JSDoc changed (`@deprecated` → `sourceImages`); the type is untouched.
  - **The maximum count is PER-ECOSYSTEM, not a constant** — derived server-side from the checkpoint's own generation-graph `images` node: SD-family / Flux.1 Kontext / Boogu / MAI **1**; Qwen / Qwen2 / MageFlow **3**; Reve / HiDream-O1 **4**; WanImage **5**; Flux.2 / Flux.2 Klein / OpenAI / NanoBanana / Seedream / Grok **7**. Over-cap is rejected, never silently truncated. A flat wire bound of 10 rejects an oversized array before parse; it is not the product cap.
  - **Every element is validated individually** (Civitai-hosted https URL + 64–2048 dimensions) — no "first element only" path. An empty array is rejected (omit the field for text-to-image). Source images are **PAGE-only**: the server rejects them on a model-bound token, array form included. Sending **both** `sourceImage` and `sourceImages` is rejected as ambiguous (TypeScript cannot express that mutual exclusion, so it surfaces as a server-side error).
  - Also corrects a now-stale constraint in the singular field's JSDoc: img2img is not SD-family-only — edit-capable ecosystems (OpenAI / Qwen / Flux Kontext / …) route to the `img2img:edit` variant, and only an ecosystem supporting neither variant is rejected fail-closed.

  🔴 **Host dependency — do not publish before civitai/civitai#3518 deploys.** The text-to-image body schema is not `.strict()`, so a host predating #3518 does not reject `sourceImages`: it silently strips the field and bills a plain text-to-image generation with no conditioning. The deprecated singular `sourceImage` works on hosts either side of #3518 and is the safe choice until it lands.

## 0.28.0

### Minor Changes

- 2238b41: Add the optional manifest `tagline` — a one-line store pitch.

  Mirrors civitai/civitai#3441, which makes `tagline` a first-class OPTIONAL
  manifest field. Previously the field existed only for off-site listings, so every
  ONSITE app's `/apps` card + detail page rendered an empty tagline slot and
  `/apps/my-submissions` warned about a field with no authoring surface anywhere.

  - `BlockManifestV1` gains `tagline?: string`.
  - New exported `BLOCK_TAGLINE_MAX_LENGTH` (140) — the same bound off-site
    listings use, so both store kinds render the same slot.
  - `defineBlock` validates it: when present it must be a string whose **trimmed**
    length is 1..140, mirroring the server's authoritative check (which also
    trims), so a padded-but-fitting value is never rejected client-side and then
    accepted at submit.
  - The vendored `schemas/app-block/v1.json` is re-vendored byte-identically from
    the canonical, and the schema-parity test ties the schema's `tagline.maxLength`
    to `BLOCK_TAGLINE_MAX_LENGTH`.

  Backward-compatible: the field is optional, so every existing manifest still
  validates and existing callers are unaffected.

## 0.27.0

### Minor Changes

- 0db05b7: Add `@civitai/app-sdk/safe-storage` — a spec-shaped in-memory `Storage` that keeps blocks alive at an opaque origin, auto-installed by the `blocks` subpath.

  Block iframes are sandboxed as `allow-scripts allow-forms` **without `allow-same-origin`**, so the document has an opaque origin and merely _reading_ `localStorage` / `sessionStorage` throws `SecurityError: … lacks the 'allow-same-origin' flag`. Guarding your own call sites doesn't help — the failure arrives through third-party dependencies, which routinely mislabel it. A live app went down this way: a panorama viewer's unguarded `KEY in localStorage` touch probe threw, the library caught it and rendered "Your browser does not seem to support WebGL", and the app's own fallback never ran. Every block that pulls in a storage-touching dependency rediscovers this, so it's fixed here once.

  `installSafeStorage(scope?)` replaces `localStorage` / `sessionStorage` with a `Map`-backed `Storage` when — and only when — a real round-trip probe shows they're unusable:

  - **No-op where storage works.** A healthy `Storage` is never replaced and its contents are never touched.
  - **No-op where storage is absent** (Node / SSR / workers). Nothing is fabricated, so `typeof localStorage === 'undefined'` feature detection still behaves server-side.
  - **Idempotent**, and safe to call as often as you like.
  - **Reads-fine-but-writes-throw** (a full quota, storage disabled) is also covered, and the fallback **inherits the existing entries first** so it can't shadow a live session — that store's data is real and readable, unlike an opaque origin's. Writes made after the swap are session-scoped like every other install path.
  - **Never throws.** Every step is guarded, including the probe's own property reads: a revoked `Proxy` or a throwing getter parked on `localStorage` classifies as broken instead of escaping. This installs at module scope, so an error here would reject `import '@civitai/app-sdk/blocks'` outright and take down every block that imports it.
  - Implemented as a **Proxy, not a class**, because real `Storage` is exotic: `KEY in storage`, `storage[KEY] = v`, `delete storage[KEY]` and `Object.keys(storage)` all behave as they do on the real thing. That exact shape is what libraries use — right down to `delete storage.getItem` being a no-op and `Object.freeze(storage)` being refused rather than permanently breaking enumeration.
  - Existence is tested with `'localStorage' in scope`, never `typeof localStorage`: in a real sandbox **`typeof` throws too**, because it still resolves the property and runs the throwing getter. `in` runs `[[HasProperty]]`, which cannot, and it correctly reports `true` there — the global exists, it is merely unreadable.

  It **installs on import**, because ES module imports are hoisted: no statement can run before a sibling import of a dependency that reads storage while evaluating — only another import can. `@civitai/app-sdk/blocks` imports it first, so blocks get the fix without knowing it exists. For a dependency imported _ahead_ of the SDK, put `import '@civitai/app-sdk/safe-storage';` at the top of your entry file; before a dynamic import, call `installSafeStorage()`.

  `package.json` now declares `sideEffects` as an allow-list (`dist/safe-storage/index.js`, `dist/blocks/index.js`) rather than leaving it unset. The whole mechanism is a bare `import '…/safe-storage'`, so a future blanket `"sideEffects": false` would let bundlers tree-shake it away — silently, since Node/vitest doesn't tree-shake and nothing would fail in CI.

  The fallback is session-scoped — nothing survives a reload, which is the honest semantic at an opaque origin. Use the app-storage messages for anything durable. `createMemoryStorage()` is exported for standalone use, and `installSafeStorage` / `createMemoryStorage` are re-exported from `@civitai/app-sdk/blocks`.

## 0.26.0

### Minor Changes

- 121c1b1: Convert `WorkflowBody` into a real discriminated union and add a bounded `customComfy` recipe member (App Blocks customComfy bridge, v1). Pure-additive and back-compatible: the existing `{ kind: 'textToImage', modelId, modelVersionId, params }` body is unchanged (now the exported `WorkflowBodyTextToImage` arm). The new `WorkflowBodyCustomComfy` (`{ kind: 'customComfy', recipe, params: { prompt, seed?, engine?, accountType? } }`) runs a server-registered, code-reviewed ComfyUI recipe end-to-end — the iframe never sends a graph; `recipe` is a registered id (unknown ids rejected server-side, fail-closed) and `params` are bounded + validated per-recipe. Mirrors civitai's forthcoming `blockCustomComfyBodySchema`. Billing is post-paid (a per-recipe display estimate, no exact pre-price; a per-recipe `maxBuzz`/timeout caps the job server-side). `useBuzzWorkflow().{estimate,submit}` now accept the full union (type-only; the hook forwards the body verbatim, no runtime change). `@civitai/blocks-react`'s peer range on `@civitai/app-sdk` is bumped to `^0.26.0` to match this minor.

### Patch Changes

- d67d3bb: Sync the App Block scope set to the canonical after civitai #3212 removed three decorative (declared-but-never-enforced) scopes: `media:read:owned`, `block:settings:read`, `block:settings:write`. Re-vendors the manifest schema mirror, drops the three entries from `BLOCK_SCOPES`, and updates the drift-guard test. A manifest declaring any of these is now rejected as unknown server-side, so `defineBlock` / `civitai app validate` now reject them locally too (previously they were falsely accepted). Restores parity with `https://civitai.com/schemas/app-block/v1.json`.

## 0.25.1

### Patch Changes

- 889c73b: Sync the vendored App Block manifest schema to the canonical: add the optional `scopeJustifications` field (per-scope free-text rationale shown to moderators during review; civitai #3195). Backward-compatible — omit it and the manifest stays valid. Restores byte-parity with `https://civitai.com/schemas/app-block/v1.json`.

## 0.25.0

### Minor Changes

- 88cf71d: Add the `PUBLISH_GENERATION_OUTPUTS`/`PUBLISH_RESULT` and `GET_IMAGES_BY_IDS`/`IMAGES_RESULT` block↔host message pairs, the `BlockGatedImage` per-viewer gated-image projection, and the `usePublishGenerationOutputs()` + `useGatedImages()` hooks. Bridges a block's own generation outputs into bare real-scanned public Image rows and reads them back under each viewer's browsing-level clamp.

## 0.24.1

### Patch Changes

- 96a1287: Docs: correct the block-scope count in the README from "10" to "15". The `BLOCK_SCOPES` enum has grown to 15 members (adding `apps:storage:shared:*` and the three `collections:*` scopes), and the README (which ships to npm as the package listing) still described "the 10 known block scope strings" in two places. README-only change; no code or contract change.

## 0.24.0

### Minor Changes

- 5a3724d: Add the app generator **subqueue** message contract to `@civitai/app-sdk/blocks`:
  the `QUERY_APP_WORKFLOWS` → `APP_WORKFLOWS_RESULT` and `CANCEL_APP_WORKFLOW` →
  `CANCEL_APP_WORKFLOW_RESULT` message pairs, plus the shared `AppWorkflow` /
  `AppWorkflowImage` types and the `AppWorkflowsParams` filter. These let an app read
  and cancel its **own** tag-scoped generations (`{ workflowId, status, images[],
cost, createdAt }`) — the host forces the per-app tag filter off the block token,
  so a block only ever sees the queue it produced. Mirrors civitai/civitai PR #3164
  (keep in lockstep).

## 0.23.0

### Minor Changes

- c5ef2df: Add the non-blocking (async-scan) cosmetic-image upload flow for App Blocks: the host early-resolves the upload modal on persist and streams the scan verdict to the block, so a display upload no longer blocks on the scan.

  - **app-sdk (`@civitai/app-sdk/blocks`):** new `BlockPendingImageInfo` (`{ status: 'pending', imageId, url }` — an author-preview-only early-resolve handle) and `BlockImageScanResult` (the discriminated async verdict `scanned` | `blocked` | `error`), both re-exported from the blocks barrel. `OPEN_IMAGE_UPLOAD` gains an opt-in `asyncScan?: boolean` (absent/false = byte-compatible blocking path); `IMAGE_UPLOAD_RESULT.selected` widens to also carry the pending handle; and a new parent→block `IMAGE_SCAN_RESOLVED` message delivers the verdict (correlated by `requestId` + `imageId`). Only the `scanned` verdict carries a usable moderated image.
  - **blocks-react:** `useImageUpload({ asyncScan: true })` returns `{ open, scanStatus }` — `open()` early-resolves a `BlockPendingImageInfo` (or `null` on dismiss) and `scanStatus(handle)` resolves the streamed verdict (buffered if it arrives first; re-callable for retry; forgery-resistant correlation by the generated `requestId`). Existing overloads (blocking `display`, `generationSource`) are unchanged. A host that predates `asyncScan` (blocking-resolves a moderated image) is handled transparently — the hook treats it as immediately-scanned. `createMockHost` models the early-resolve → async verdict with a new `cannedImageScan` option (`'scanned'` default | `{ status: 'blocked', reason? }` | `'error'`).
  - The block-side security invariant is unchanged: the pending handle is author-preview-only, only a `scanned` verdict carries the moderated image projection, and cross-user serving stays gated server-side.

  blocks-react bumps its `@civitai/app-sdk` peer range `^0.21.0` → `^0.22.0` in lockstep (it consumes the new types), so the app-sdk minor does not force a blocks-react major.

## 0.22.0

### Minor Changes

- 522d051: Add the `GET_VIEWER` → `VIEWER_RESULT` message pair to the `blocks` postMessage contract, mirroring the host `blocks.getMyViewer` bridge being added in parallel in civitai/civitai.

  - **`GET_VIEWER` → `VIEWER_RESULT`** — the signed-in viewer self-read (`{}` → `{ viewer: BlockViewer }` | `{ error }` free-text). Token-bound: the host resolves the viewer from the block token and reads via `blocks.getMyViewer`; an anonymous / banned token comes back as the reply's free-text `error`.

  New shared result type `BlockViewer` in `blocks/types.ts` (re-exported from `@civitai/app-sdk/blocks`): `{ id: number; username: string | null; status: 'active' | 'muted'; buzzBudget: number | null }`, documented as mirroring its civitai/civitai `blocks.getMyViewer` projection (PR #3152) with a "keep in lockstep" note. Distinct from the BLOCK_INIT-embedded `ViewerInfo` — `status` is the narrow spendable/mutable pair. NULLABILITY: `username` and `buzzBudget` are present-but-NULLABLE (the host returns `username: null` for a viewer with no handle, `buzzBudget: null` when the token lacks the budget claim), not omitted — consumers and the guard must accept `null` for both.

  Follows the `GET_BUZZ_BALANCE` / `BUZZ_BALANCE_RESULT` value-or-error convention exactly.

## 0.21.0

### Minor Changes

- c9548f3: Add the buzz self-read + wildcard-pack message pairs to the `blocks` postMessage contract, catching the SDK up to the host bridges shipped in civitai/civitai (#3144 buzz reads, #3133 wildcard). Four new request→reply pairs:

  - **`GET_BUZZ_TRANSACTIONS` → `BUZZ_TRANSACTIONS_RESULT`** — the Buzz-dashboard ledger read (`{ params? }` → `{ result: { cursor?, transactions: BlockBuzzTransaction[] } }` | `{ error }` free-text). Scope `buzz:read:self`.
  - **`GET_BUZZ_ACCOUNTS` → `BUZZ_ACCOUNTS_RESULT`** — all-pool balances (spendable + creator payout pools; `{ result: { accounts: BlockBuzzAccount[] } }` | `{ error }`). Scope `buzz:read:self`.
  - **`GET_DAILY_COMPENSATION` → `DAILY_COMPENSATION_RESULT`** — per-modelVersion generation earnings for the month of `date` (`{ result: { resources: BlockDailyCompensationResource[], hasPublishedResources } }` | `{ error }`). Scope `buzz:read:self`.
  - **`GET_WILDCARD_PACK` → `WILDCARD_PACK_RESULT`** — parsed wildcard-pack import by model version (`{ modelVersionId }` → `{ pack: BlockWildcardPack }` | `{ error }`). The error is a **discriminated enum** (`BlockWildcardPackErrorCode`: `not-found` | `forbidden` | `too-large` | `parse-failed` | `busy`), NOT free-text. Token-independent (no block scope).

  New shared result types in `blocks/types.ts` (re-exported from `@civitai/app-sdk/blocks`): `BlockBuzzTransaction`, `BlockBuzzAccount`, `BlockDailyCompensationResource`, `BlockWildcardPack`, `BlockWildcardPackErrorCode` — each documented as mirroring its civitai/civitai source (`projectBlockBuzzTransaction`, `getMyBuzzAccounts`, `getDailyCompensationRewardByUser`, `ResolveWildcardPackResult` + `wildcardPackParse`) with a "keep in lockstep" note. Plus the request-param types `BlockBuzzTransactionsParams` / `BlockDailyCompensationParams`.

  DATE WIRE NOTE: a transaction's `date` and the page `cursor` are documented as ISO-8601, but the host currently forwards the raw tRPC `result` over structured-clone `postMessage` (it does not `.toISOString()`-map it the way the `SHARED_LIST` bridge does), so they arrive as `Date` instances at runtime. The block-side guard + hook tolerate both.

  This completes the SDK message contract for the App Blocks host bridges; the other 10 host bridges were already shipped.

## 0.20.0

### Minor Changes

- 0ae2821: Add `useSharedStorage().update(key, value)` — an author-scoped, in-place update of a SHARED-storage entry the viewer contributed. Mirrors the new civitai platform op `apps.shared.update`.

  - **`@civitai/app-sdk`** (`blocks`): new postMessage pair `SHARED_UPDATE` (block→parent, `{ requestId, key, value }`) and `SHARED_UPDATE_RESULT` (parent→block, `{ requestId, ok, error? }`). Reuses the existing `SharedStorageValue` (`{ title, body?, data? }`) — no new value type.
  - **`@civitai/blocks-react`**: `useSharedStorage()` gains `update(key: string, value: SharedStorageValue): Promise<void>` alongside `append`/`list`/`vote`/`unvote`/`withdraw`. Resolves once the update lands; rejects with the host's `error` (`NOT_FOUND` when the key is missing/hidden, `FORBIDDEN` when the viewer isn't the author, or a belt/size rejection). Gated by the same `apps:storage:shared:write` scope as `append` — no new scope. The entry's `key` and vote/report totals are preserved; only the contributed `{ title, body?, data? }` value changes.

  The `createMockHost` SHARED backend now answers `SHARED_UPDATE` (author gate + `NOT_FOUND`/`FORBIDDEN`/`INVALID_VALUE`), so `dev:mock` exercises the full author-scoped update path locally.

## 0.19.0

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

## 0.18.0

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

## 0.17.0

### Minor Changes

- 18ef496: Sync the vendored App Block manifest schema + SDK constants with the canonical server-published schema (https://civitai.com/schemas/app-block/v1.json). Adds the three App Blocks Collections scopes `collections:read:self`, `collections:write:self`, and `collections:read:private` to `BLOCK_SCOPES` and the schema's `scopes` enum. All three are 3-segment, so the existing `BLOCK_SCOPE_PATTERN` already accepts them (no widening needed — that was the `apps:storage:shared:*` sync in #131). The schema↔`BLOCK_SCOPES` parity/drift-guard test and the `defineBlock` scope-acceptance tests are extended to cover the three additions. Purely additive for authors — these scopes are now declarable in a manifest and validated by membership; the server continues to gate them per-op (collection visibility/ownership + maturity clamp on read, self-bound actor on follow/write, explicit consent for `collections:read:private`).
- 4600603: Sync the vendored App Block manifest schema + SDK constants with the canonical server-published schema (https://civitai.com/schemas/app-block/v1.json). Adds the two 4-segment shared-storage scopes `apps:storage:shared:read` / `apps:storage:shared:write` to `BLOCK_SCOPES` and the schema's `scopes` enum, widens `BLOCK_SCOPE_PATTERN` to accept 4 colon segments (now only a format heuristic — membership is enforced against `BLOCK_SCOPES`), and adds the optional `category` manifest field backed by a new `BLOCK_CATEGORIES` const + `BlockCategory` type (the 7 marketplace categories). `defineBlock` now rejects a well-formed-but-unknown category and validates `category` against the canonical set. The schema↔`BLOCK_SCOPES` parity test is now a real drift guard (Set equality), extended to cover the category enum. Additive for authors; the only new rejection (`category` must be a known value) matches what the server already enforces.

## 0.16.0

### Minor Changes

- 688a835: Split OAuth endpoints (auth.civitai.com) from API endpoints (civitai.com) after the auth server breakout; add CIVITAI_AUTH_URL.

  The OAuth flow now lives on the standalone auth hub. `buildAuthorizeUrl`, `exchangeCode`, `refreshToken`, and `revokeToken` default `baseUrl` to `https://auth.civitai.com`, while `fetchMe` (`/api/v1/me`) and `fetchBuzzAccount` (buzz tRPC) stay on `https://civitai.com`. The starters gain a `CIVITAI_AUTH_URL` env var and point their OAuth calls at it, keeping `CIVITAI_BASE_URL` for `/api/v1/me` and tRPC/buzz calls.

## 0.15.0

### Minor Changes

- 2809475: App Blocks **SHARED (app-global / cross-user) storage** — `useSharedStorage` + the `SHARED_*` message contract.

  - **`@civitai/app-sdk`**: adds the `SHARED_LIST / SHARED_GET_COUNT / SHARED_GET_COUNTS / SHARED_APPEND / SHARED_VOTE / SHARED_UNVOTE / SHARED_WITHDRAW` request/reply message types + the `SharedStorageValue` / `SharedStorageItemWire` types (the block↔host contract for the shared datastore). Publishing these is required for `@civitai/blocks-react`'s new hook types to resolve for consumers.
  - **`@civitai/blocks-react`**: new `useSharedStorage()` hook (`list` / `append` / `vote` / `unvote` / `withdraw` / `getCount` / `getCounts` over a per-app, cross-user store) + a `shared` scenario in `createMockHost` for local dev. Pairs with the civitai host bridge + server core.

## 0.14.0

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

- a563b08: Align the App Block manifest schema and `defineBlock` runtime checks to the now-published canonical schema at https://civitai.com/schemas/app-block/v1.json (the single source of truth shared by the server validator and the `civitai` CLI).

  - The vendored `schemas/app-block/v1.json` is now a byte-identical copy of the canonical (was a stale, divergent draft-07 copy), and a CI drift-check (`scripts/check-canonical-schema.sh` / `pnpm check:schema`) fails on any difference so it can't silently diverge again.
  - `defineBlock` now enforces the canonical `blockId` rule: `/^[a-z][a-z0-9-]*[a-z0-9]$/`, length 3–40 (DNS-subdomain-safe, since the blockId becomes `<blockId>.civit.ai`) — tightened from the previous `/^[a-z0-9-]{3,64}$/`.
  - `defineBlock` now validates `scopes` by **membership** in the canonical 10-scope enum (`BLOCK_SCOPES`), matching how the schema validates them — a well-formed but unknown scope (e.g. `models:read:all`) is now rejected. The `domain:verb:target` pattern is kept only as an error-message helper.

  BREAKING-ish for authors: this can reject manifests that previously passed `defineBlock` — specifically blockIds that are 41–64 chars, start with a digit/hyphen, or end in a hyphen, and any scope not in the approved set. These would have been rejected server-side anyway; the SDK now surfaces them at `pnpm dev` time.

### Patch Changes

- ec5afff: Add the `apps:storage:read` / `apps:storage:write` block scopes (W4 KV datastore) to `BLOCK_SCOPES`. The convenience map was missing them, so authors had no `BLOCK_SCOPES.APPS_STORAGE_*` constant for the per-app storage scopes even though the server accepts them. A new test pins `BLOCK_SCOPES` to the server's canonical block-scope set to catch future drift.
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

## 0.13.1

### Patch Changes

- f20d590: docs: repoint the App Blocks README link to the real guide

  The `blocks/*` row linked "Civitai App Blocks" at the bare
  `developer.civitai.com` dev portal, which has no App Blocks content. Point it at
  the public "Build your first App Block" guide in this repo so readers land
  somewhere that actually documents App Blocks.

## 0.13.0

### Minor Changes

- 37d8465: Add color-domain maturity to the App Blocks contract. `BlockInitPayload` now
  carries optional `domain` (`green`|`blue`|`red`|`null`) and `maxBrowsingLevel`
  (an authoritative browsing-level bitmask) projected by the host (civitai #2670).
  Adds a `browsingLevel` module: per-level `BrowsingLevel` bit constants (mirroring
  the server `NsfwLevel`), `SFW_LEVELS`/`NSFW_LEVELS` flags, and pure
  `isSfwCeiling(maxBrowsingLevel?)` / `isLevelAllowed(level, maxBrowsingLevel?)`
  helpers that derive SFW from the bitmask (policy stays server-side) and
  **fail-closed to SFW** when the ceiling is absent/non-finite. Additive only.

## 0.12.0

### Minor Changes

- f600390: Add `modelName` + `versionName` to `BlockResourceInfo` (the PAGE resource picker
  result that `useResourcePicker` resolves to + the `RESOURCE_PICKER_RESULT`
  payload). These are the public display names of the user-picked resource, so a
  block can render the chosen Checkpoint/LoRA by name instead of `#<id>` — mirrors
  the names `BlockCheckpointInfo` (the model-slot/checkpoint picker) already
  carries. The host projection in civitai/civitai's `PageBlockHost.tsx` is updated
  in lockstep.

## 0.11.0

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

## 0.10.0

### Minor Changes

- 1790749: Add optional `additionalResources` (LoRA) field to the `WorkflowBody` block→host
  contract. Mirrors civitai's `blockWorkflowBodySchema` (PRs #2640/#2641): an
  optional array of `{ modelVersionId: number; strength?: number }` (max 5 entries;
  strength in `[-1, 2]`, server-defaulted to 1) layered on top of the checkpoint
  `modelVersionId`. The server is LoRA-only for additional resources and enforces
  base-model-family compatibility + per-resource entitlement before any Buzz spend.

  Purely additive and backward-compatible — existing checkpoint-only bodies that
  omit the field still type-check, and the host already forwards the block body
  verbatim so no host change is required. `@civitai/blocks-react` consumes
  `WorkflowBody` by reference (`useBuzzWorkflow().submit / .estimate`), so blocks
  can now pass LoRAs through with full type safety.

## 0.9.0

### Minor Changes

- Add the `REQUEST_SIGN_IN` block→host message (anonymous conversion). New
  variant on the `BlockToParentMessage` union with payload `{ returnUrl?: string }`.
  A block rendered for a logged-out viewer (`BLOCK_INIT.viewer === null`) sends
  this to ask the host to start civitai.com's login flow when the user clicks an
  action that needs auth/money (e.g. Generate). The host validates it like every
  inbound message (origin + `event.source` pinned, only honored after
  `BLOCK_READY`) and sanitises `returnUrl` to a same-origin in-app path,
  defaulting to the current page when omitted.

- Add the `REQUEST_CONSENT` block→host message (lazy consent). New variant on the
  `BlockToParentMessage` union with payload `{ scopes?: string[] }`. A block
  rendered for a LOGGED-IN viewer whose token is missing a consent-gated scope
  (e.g. `ai:write:budgeted` / `buzz:read:self` were withheld at mint because the
  viewer hasn't granted them yet) sends this to ask the host to open its consent
  UI when the user clicks an action that needs that capability — instead of
  prompting on load. The host already knows the missing scopes (from the mint
  response), so `scopes` is an optional advisory hint. Fire-and-forget — on grant
  the host re-mints and pushes a `TOKEN_REFRESH` carrying the now-granted scopes;
  the block observes the new scope and retries.

## 0.8.0

### Minor Changes

- e6e3858: Add `fetchBuzzAccount` helper (and `BuzzAccount` / `BuzzAccountType` types) to
  read the OAuth-authenticated user's Buzz balance. `/api/v1/me` does not
  include balance — it lives behind the `buzz.getUserAccount` tRPC procedure
  and requires the `BuzzRead` scope. Exported from `@civitai/app-sdk` and
  `@civitai/app-sdk/oauth`.

### Patch Changes

- 13ba162: Refresh the published READMEs for the App Blocks packages (these ship in the
  tarballs via `files`). `@civitai/app-sdk` gains an "App Blocks contract"
  section (message/transport protocol, `BLOCK_INIT` shape, `defineBlock`
  validator rules, version compatibility). `@civitai/blocks-react` documents
  every hook with a minimal snippet, the `/ui` `SettingsForm` subexport, the
  `useBuzzWorkflow` status semantics, and the self-set `data-theme` requirement;
  it also fixes the quick-start `submit()` snippet (full `WorkflowBody`, not
  `{ prompt }`) and lists all ten hooks (was eight). `@civitai/blocks-cli`
  clarifies that `deploy` is preflight-only and maps the commands to the
  `/apps/submit` review flow. No code changes.

## 0.6.0

### Minor Changes

- Add `@civitai/app-sdk/blocks` subpath: framework-agnostic contract for Civitai App Blocks.

  - `defineBlock(config)` validates a `BlockManifestV1` at startup and returns it unchanged. Enforces the immutable-blockId pattern, integer `iframe.minHeight` / `iframe.maxHeight` (matching the JSON schema), blocks `allow-same-origin` / `allow-top-navigation` sandbox flags (including the `-by-user-activation` and `-to-custom-protocols` variants), requires HTTPS iframe src (with a localhost escape hatch for dev — `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`), and rejects PascalCase scope strings with a pointed error message.
  - `BLOCK_SCOPES` / `BlockScope` / `BLOCK_SCOPE_PATTERN` — colon-separated lowercase block-scope strings, distinct from the OAuth `TokenScope` bitmask.
  - Typed postMessage protocol (`ParentToBlockMessage`, `BlockToParentMessage`, `BlockInitPayload`, `isMessage()` narrowing helper, `WrappedToken` shared by `BLOCK_INIT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE`) for hosts and block runtimes to share. `TOKEN_REFRESH` is the host-pushed rotation message (no `requestId`); `TOKEN_REFRESH_RESPONSE` is the reply to a block-initiated `REQUEST_TOKEN` (optional `requestId`). Both carry the same wrapped-token shape.
  - Manifest + context types: `BlockManifestV1`, `BlockContext`, `ModelSlotContext` (the concrete narrowing for `model.sidebar_top` / `.below_images` / `.actions_extra`), `BlockToken`, `BlockSettings`, `ViewerInfo` (signed-in viewer only — `BlockInitPayload.viewer` is `ViewerInfo | null` so anon is explicit), `Theme` (`'light' | 'dark'`), `BlockWorkflowSnapshot`, etc.
  - Aligned with civitai/civitai's `src/components/AppBlocks/types.ts`: same `BLOCK_INIT` field layout, same scope strings, same viewer/theme shapes.
  - `schemas/app-block/v1.json` JSON Schema (draft-07) ships with the package and is also exported via the `./schemas/app-block/v1.json` subpath for offline validation.

  React hooks and the iframe transport ship in a follow-up package — this subpath stays runtime-agnostic.

- Manifest-driven settings (W3 v0): `ManifestSettings`, `SettingField`, and per-widget field types (`NumberSettingField`, `StringSettingField`, `BooleanSettingField`) under `@civitai/app-sdk/blocks`. Each field declares `scope: 'publisher' | 'viewer'`, a widget hint (`number | slider | toggle | text | textarea | select | resource_picker`), and optional `requires_scope` gating. Manifests now declare their settings shape directly; the host renders the UI generically.

- App Storage KV substrate (W4 v0): five new message pairs for host-mediated KV storage under `@civitai/app-sdk/blocks` — `APP_STORAGE_GET` / `APP_STORAGE_GET_RESULT`, `APP_STORAGE_SET` / `APP_STORAGE_SET_RESULT`, `APP_STORAGE_DELETE` / `APP_STORAGE_DELETE_RESULT`, `APP_STORAGE_LIST` / `APP_STORAGE_LIST_RESULT`, `APP_STORAGE_QUOTA` / `APP_STORAGE_QUOTA_RESULT`. All requests carry a `requestId` for correlation; responses include either a `value`/`keys`/`quota` payload or a typed `error`.

## 0.5.0

### Minor Changes

- `autoClaim` field added to `BlockWorkflowSnapshot` so hosts can signal an in-flight daily-boost claim during `submitWorkflow`.

## 0.4.0

### Minor Changes

- `clipSkip` added to `ShowcaseImage` and `BlockTextToImageParams` (textToImage discriminated union).

## 0.3.0

### Minor Changes

- `ShowcaseImage` type + `ModelSlotContext.showcaseImages`. `WorkflowBody` narrowed to a typed `textToImage` discriminated union. `useCheckpointPicker` contract.

## 0.2.0

### Minor Changes

- b3a73a7: Add `imageGen` step support and discoverable workflow step catalog.

  - **`buildImageGenBody(input, opts)`** — body builder for the `imageGen` step type (Nano Banana, Gemini, GPT-Image, Flux.1 Kontext, Flux.2, Seedream, Grok, fal, etc.). Reference images go in `input.images: [...]`. Per-engine input is pass-through so new fields work without an SDK release.
  - **`buildWorkflowBody(step, opts)`** — generic single-step envelope builder. Use when no dedicated `build*Body` exists for your step `$type`.
  - **`WORKFLOW_STEP_TYPES`** + **`WorkflowStepType`** — in-code catalog of every workflow step type the orchestrator accepts, with one-line descriptions. Removes the need to read the OpenAPI spec to find the right `$type`.
  - **`IMAGE_GEN_ENGINES`** + **`ImageGenEngine`** — catalog of the closed-source image-gen engines that the `imageGen` step accepts (`google`, `gemini`, `openai`, `flux1-kontext`, `flux2`, `seedream`, `grok`, `fal`, `wan`, `sdcpp`, `comfy`).
  - **`ImageGenInput`** — pass-through input type for `buildImageGenBody`.

All notable changes to the published SDK package are recorded here.
Maintained automatically by [changesets](https://github.com/changesets/changesets) — see
[`.changeset/README.md`](../../.changeset/README.md) for how to add an
entry.

## 0.1.0

Initial public release.

OAuth (PKCE + token exchange + refresh + revoke), encrypted-cookie session
helpers (`sealCookie` / `unsealCookie`, AES-256-CTR), scope bitmask helpers,
and the orchestrator client factory + `pollWorkflow` / `estimateWorkflow` /
`submitWorkflow` / `getWorkflow` helpers. Subpath exports: `/oauth`,
`/scopes`, `/cookies`, `/orchestrator`.

Powers the four starter templates under
[`civitai/civitai-app-starters/starters/*`](https://github.com/civitai/civitai-app-starters/tree/main/starters).
