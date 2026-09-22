# @civitai/blocks-react

## 0.57.1

### Patch Changes

- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
- Updated dependencies [266a021]
  - @civitai/components@0.5.0
  - @civitai/theme@0.4.0

## 0.57.0

### Minor Changes

- cab0ee5: Name the `responseToResources` parameter, and gate the public type surface on the built `.d.ts` (#379).

  **`minor`, and the only reason it is not `patch`: two types gain a public name.**
  `@civitai/blocks-react` now exports `RawGenerationResourcesResponse` and
  `RawGenerationResource`. Nothing is removed, nothing is renamed, no existing
  import can break.

  ## What #379 actually was, re-measured

  The issue reported **47 reference sites where a public export names a type the
  consumer cannot import**, measured at `eed2df5`. Re-derived at `e993cf0` through
  the TypeScript API over the built `.d.ts` of every `exports` key, the count is
  still 47 — but it is **not the same 47**. #416 had already closed every
  `Use<Hook>Return` the issue named; six further names it listed (`ScanEntry`,
  `OriginMatcher`, `PendingRequest`, `ActiveToast`, and `liveHost`'s three trpc
  result types) are local-variable and private-field types that never reach a
  `.d.ts` at all; and `UseImageUploadOptions` is exported today. The matching total
  is coincidence.

  Classified by POSITION, **46 of the 47 are not friction**, and that was measured
  rather than argued. An external consumer project — outside the workspace,
  installed from the real `pnpm pack` tarballs — constructs, reads, stores and
  wraps every affected exported type without ever naming the hidden one, at **0
  type errors**, while a companion file importing the 8 hidden names directly
  errors on **all 8** (`TS2305` / `TS2459` / `TS2724`). An exported interface that
  `extends` a non-exported base inlines every member: a consumer writes
  `ExchangeCodeOpts` and gets `clientId` / `clientSecret` / `baseUrl` /
  `fallbackScope`, and `Pick<RefreshTokenOpts, …>` names the shared half.
  `Extract<ResourceCardProps, { variant: 'card' }>` names a union arm.
  `keyof WorkflowStepTemplates` is `keyof StepTemplateMap` — which is
  non-exported **by design**, with an invariant and a test in
  `@civitai/app-sdk/orchestrator/steps` that exporting it would break.

  ## The one real defect

  `responseToResources(raw: RawGenerationResourcesResponse | null | undefined)` —
  an exported function's **parameter**. A caller doing its own fetch has to produce
  that value, and the only way to type the fetch was
  `Parameters<typeof responseToResources>[0]`: naming the function in order to name
  its input. Both the response and its row type are exported now, because a
  response type whose `items` element had no name would move the same problem one
  level down. They are the WIRE shape — every field optional and unvalidated, so
  the mapper survives a malformed row. Type a fetch with them; the checked shape is
  the `BlockResourceInfo[]` the mapper returns.

  ## The guard

  `pnpm check:public-types` resolves every type reference in every built `.d.ts`
  entry against what the `exports` map actually publishes. Return types, function
  parameters and callback returns must be exported outright; every other position
  is on an audited exemption ledger that records the name-free route a consumer
  takes, asserted as an exact multiset so a new violation fails until someone
  writes the route down. It fails loudly on an unbuilt tree rather than reporting a
  vacuous zero, and `--self-test` runs a deliberately-unexported fixture and its
  exported twin before the real scan is believed.

- 95e8d8f: Make two `src/internal/validate.ts` guards do what their comments claimed (#384, #394).

  **`hidden` gated images are now narrowed structurally, not by banning one spelling (#384).**
  `isValidGatedImage`'s docblock said a `hidden` entry is "ONLY `imageId` + `status`"; the
  code rejected exactly one key, the literal `url`. A host attaching `previewUrl`, `src`,
  `imageUrl` or any other field to a WITHHELD image forwarded it straight to
  `useGatedImages().getImages()` — measured, not inferred: each of those four spellings
  reached the consumer on the previous release.

  The fix is PROJECTION, not rejection. `projectInboundPayload` runs on every
  `IMAGES_RESULT` at the transport boundary — before `pending.resolve`, so a consumer using
  the public `getTransport()` + `sendTypedRequest()` is covered as well as one using the
  hook — and narrows each `hidden` entry to exactly `{ imageId, status }`. A `url` on a
  `hidden` entry stays fatal, because the contract explicitly forbids that key and its
  presence is a live moderation breach worth surfacing loudly.

  **Consumer-visible behaviour change, and the reason this is a `minor`:** a block that was
  reading an extra field off a `hidden` entry stops seeing it. That is the point of the
  change, but it is a change. Nothing in the documented `BlockGatedImage` contract ever
  promised those fields, and `visible` entries are untouched (returned by identity).

  Rejection was the literal ask in #384; projection was chosen instead because rejection
  fails the WHOLE batch — `isValidImagesResult` returns false for one bad entry,
  `handleMessage` drops the reply before correlation, and `getImages()` then hangs to its
  transport timeout rather than rejecting. The host is a separate repo on a separate release
  cadence, so an allowlist-by-rejection would turn any future host-side field addition into a
  block-wide hang. Dropping the key gives the same guarantee at no forward-compat cost.

  **`payloadValidatorFor` is now exhaustive over `ParentToBlockMessage` at compile time (#394).**
  Adding a member to the union without a validator entry previously type-checked, built, and
  shipped an unvalidated path that reached `pending.resolve` and push handlers. The
  `default:` arm now binds the switch subject to `never`, so the omission fails `tsc`:

  ```
  error TS2322: Type '"SYNTHETIC_MUTANT_RESULT"' is not assignable to type 'never'.
  ```

  The runtime `default:` still returns `null` for a type the union does not declare, which is
  now a documented choice rather than an accident: such a type cannot reach `pending.resolve`
  or a push listener (both keyed to the union) and matches none of the `isMessage` branches,
  so failing closed would protect nothing while making every older block in the fleet warn
  and emit a rejection beacon the first time a newer host ships a new message type.

- a07f7e9: Give every auto-fetching hook a latest-wins request guard, settle `useImageUpload`'s pending scan promises on unmount, and stop `useTipAllowance` spinning forever without a host origin (#392, #393, #398).

  **#392 — a slow earlier reply could overwrite newer state, in EIGHT hooks.**
  `useAppWorkflows`, `useBuzzAccounts`, `useBuzzBalance`, `useBuzzTransactions`,
  `useDailyCompensation`, `useTipAllowance`, `useViewer` and `useWildcardPack` each
  guarded only _unmount_. Nothing correlated a reply with the request that produced
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

- e993cf0: Name every hook's return type, move the entry's transport modules out of `internal/`, and replace two stale docblock claims (#378, #380, #381, #388).

  **`minor`, because the public type surface GREW (#380).** 19 hooks gained an exported `Use<Hook>` return type and roughly 25 new type exports landed on the package entry. Nothing was removed and nothing changed shape, so no consumer needs to do anything — but new exported API is a feature, not a patch. `@civitai/app-sdk` takes a `patch`: a comment-only correction that nevertheless ships, because JSDoc travels in `.d.ts`.

  **Every hook exported from `@civitai/blocks-react` now ships a named, exported return type (#380).** Whether one existed was a coin flip — measured on `bcc24bf`: 37 files under `src/hooks/use*.ts`, 17 with an exported `Use<Hook>`, 20 without. A consumer wrapping `useBlockContext()` had to hand-copy a ten-field `Pick<BlockSnapshot, …>` that existed only on the function's own return annotation. `UseBuzzWorkflowReturn` — which existed but was never exported, the same defect from the other side — is now `UseBuzzWorkflow`.

  The rule is "every hook **exported from the package entry**", not "every `use*.ts` file". `useRequestSequencer` is a hook-shaped file that #413 added as the shared request sequencer the public hooks build on; publishing a return type for it would publish an implementation detail to satisfy a guard. It is recorded as internal with that reason, and a separate assertion fails if it ever reaches the entry.

  Inside the rule there are no exceptions: `UseBlockResize = void` and `UseBlockTheme = Theme` are aliases, because an exception list is a thing to remember and get wrong. `useImageUpload` is overloaded, so its return type is a family — each public overload names its own, and the implementation signature's type is asserted to stay OFF the entry.

  Three checks, three different failure modes, none subsuming another: a guard asserts the hook SET against written ledgers (failing when the set **grows** as well as when a type is deleted), the same guard reads the return **annotation** and requires the name, and `src/hooks/returnTypeLedger.ts` asserts `Exact<ReturnType<typeof useX>, UseX>` for all 36 entry hooks. The third does not subsume the second — measured, not assumed: re-inlining an annotation as a literal of the same shape leaves `tsc` completely green.

  **Nine modules moved from `src/internal/` to `src/transport/` (#378).** `src/index.ts` published 14 symbols out of a directory named `internal/`, six of them deliberately public per README § "Lower-level transport". The name told contributors that `IframeTransport`, `sendTypedRequest`, `getTransport` and `RequestTimeoutError` were private and free to move. **Nothing is removed and no import path a consumer can legitimately write has changed** — the exports map publishes `.`, `./ui`, `./testing` and `./live`, and all four are unchanged. Only the layout under `dist/` moved, which is not a supported import surface.

  `src/internal/` keeps what the main entry does not reach — the mock host, the live host, the picker overlay, the catalog client, consent, the reply-error shaper — so the split now matches the export reality rather than a wholesale rename that would have filed the live host under `transport/`.

  **Two stale docblock claims, both about things a reader would believe (#381, #388).** `useBuzzWorkflow`'s docblock said `WorkflowBody` has "THREE members" and then certified the list "otherwise unchanged"; it has four — `WorkflowBodyPassThroughStep` landed in #310. The count is now stated structurally or not at all: the prose states none, and a mutual-assignability assertion against the union fails `tsc` when it changes in either direction.

  And `waitSeconds` was documented as "🔴 CURRENTLY ADVISORY … a host that does not yet read the field simply answers immediately". The deployed host honours and clamps it. The real contract is now written down, read off `civitai/civitai` @ `b0eb2820b5` (5.1.120): `MAX_BLOCK_POLL_WAIT_SECONDS = 15`, `Math.floor` applied **first** (so `0.9` is no hold at all, not a short one), a floored value `<= 0` meaning no hold, and otherwise `Math.min(floored, 15)`. Practically: only whole seconds are expressible, and asking for more than 15 buys nothing — `intervalMs` remains what bounds your request rate. The sha is quoted because this is prose about another repo and no guard in this one can check it; the honest check is a human read at a named revision.

- f913811: Normalise `allowedParentOrigins` entries, and name the origins actually seen when `BLOCK_INIT` times out (#397).

  `OriginMatcher` only `.trim()`ed each entry and then compared it to `event.origin`
  by raw string equality. A browser reports an origin with no trailing slash, a
  lowercase scheme and host, and default ports elided — so `https://civitai.com/`,
  `HTTPS://CIVITAI.COM` and `https://civitai.com:443` each produced an allowlist
  that matched nothing, a block that sat blank for ten seconds, and a timeout error
  that named neither the origin that arrived nor the allowlist it was checked
  against.

  Entries are now canonicalised with the URL parser. Accepted as equivalent: a
  trailing slash, scheme/host case, an explicit **default** port, and an IDN host
  (normalised to the punycode a browser reports). Deliberately still significant: a
  **non-default** port, the scheme, a trailing-dot host, and the exact host — a
  prefix collision such as `https://civitai.com.evil.com` never matches
  `https://civitai.com`. Wildcard entries (`https://*.civitaic.com`) go through the
  same canonicalisation, so they obey the same rules instead of a second copy of
  them.

  🔴 Only ENTRIES are normalised. The candidate handed to `matches()` is still
  compared as given, because a real `event.origin` is already canonical and a
  `.origin` round-trip on the candidate could only add accepts (`new
URL('https://civitai.com/evil').origin` is `https://civitai.com`).

  An entry that is not a bare origin now **throws at construction** instead of being
  silently kept as an entry that can never match: no scheme, a path/query/fragment,
  credentials, or a scheme whose origin serialises to the literal `"null"` (which is
  also what a sandboxed opaque frame reports, so accepting it would allowlist every
  opaque frame at once).

  The init-timeout error now reports which origins were received and rejected, which
  were accepted without yielding a valid `BLOCK_INIT`, or that nothing arrived at
  all — bounded to five distinct origins per bucket, and labelled as truncated past
  that. A pre-init rejection also warns once per distinct origin.

  **Why `minor`, not `patch`:** the permissive half accepts allowlist spellings that
  previously matched nothing, which changes observable behaviour for existing
  configs; and the strict half turns four classes of malformed entry from a silent
  no-op into a constructor throw. Both are behaviour changes rather than fixes to a
  crash, so this is not a bugfix-only release even though the permissive direction is
  what motivated it.

- d2b9ef5: Close the two ways `dev:live` diverged from the protocol it claims to mirror: three
  block→parent messages that got no reply at all, and a picker that dropped a required
  field (#386, #391).

  **MINOR, not patch, and for two separate reasons.** `createLiveHost` gains capability it
  did not have — `SHARED_GET` and `SHARED_REPORT` are now SERVED — which is new
  functionality rather than a repair of existing functionality. And `#391` changes a
  payload consumers RECEIVE: `RESOURCE_PICKER_RESULT.selected.modelType` was `undefined`
  in `dev:live` and now carries the resolved type. No public API is removed or narrowed;
  `@civitai/blocks-react/live` still exports exactly `createLiveHost` + `LiveHostOptions`.

  ***

  ### `SAVE_IMAGE`, `SHARED_GET` and `SHARED_REPORT` no longer hang for 30 seconds (#386)

  `liveHost.ts`'s dispatch switch ends in `default: return` — a fall-through that sends
  NOTHING back. Three block→parent types had no `case` at all, so a block calling
  `useSaveImage().saveImage(…)`, `useSharedStorage().get(key)` or `.report(key, reason)`
  under `dev:live` got silence, then a generic `RequestTimeoutError` after the 30 s
  `DEFAULT_REQUEST_TIMEOUT_MS` — while the identical call resolved under `dev:mock`. The
  developer's only evidence was "live is broken, somehow, after 30 seconds".

  They were also the only three silent ones. Every other capability the live host cannot
  serve already refuses explicitly, with a `logOnce` and an honest reply.

  Two of the three are now **served**, one is **refused**, and the split is not arbitrary:

  - **`SHARED_GET` → `apps.shared.get`** and **`SHARED_REPORT` → `apps.shared.report`**,
    on the same block-token convention as the eight `SHARED_*` bridges already forwarded.
    Neither needs host chrome or a session, so refusing them would have been a limitation
    this host does not actually have. `SHARED_GET` resolves a missing / hidden / withdrawn
    row to `item: null` with **no** `error` — a `?g=<key>` deep-link must not be able to
    tell "hidden from you" from "does not exist". The row mapper is now ONE function
    shared with `SHARED_LIST` instead of an open-coded copy, and it forwards `viewerVoted`
    when the server sends it, so a deep-linked row hydrates its vote button instead of
    guessing.

  - **`SAVE_IMAGE` is REFUSED, and refusing is the point.** The real bridge is a security
    boundary, not a convenience: the host fetches the blob in its UNSANDBOXED top frame,
    allowlisting a `url`'s origin to the civitai image/blob CDN, and routing an `imageId`
    through the same per-viewer gated read that backs `GET_IMAGES_BY_IDS`. This harness
    has neither gate — the allowlist is the production host's, not this SDK's. A dev-side
    "download it anyway" would accept URLs production refuses and let a block ship having
    never once handled the refusal; inventing a divergent allowlist would be a security
    posture nobody reviewed, exercised only in dev. So it replies immediately with an
    actionable error naming `dev:mock`, rather than the silent 30 s hang.

  The gap is now **structural**. `tests/guards/livehost-message-coverage.test.mjs` asserts
  that every member of the protocol's own `BLOCK_TO_PARENT_MESSAGE_TYPES` is a `case` in
  `liveHost.ts` (except `BLOCK_HELLO` / `BLOCK_MESSAGE_REJECTED`, which the protocol
  documents as having no reply at all), that neither host cases on a label the protocol
  does not declare, and that the live-vs-mock case-set difference is EXACTLY the declared
  fire-and-forget ledger. `tsc` cannot make any of those claims: the switch subject is a
  widened `string`, so the switch is exhaustive by construction and a typo'd label
  type-checks.

  🔴 The ledger fails on **GROW and SHRINK** — it is a set equality against a declared
  expected difference, not a one-directional "every mock case exists in live". That
  one-directional shape is exactly what let an extra `./css/tabs` subpath ship in #359.
  Both directions were mutation-tested: adding a spurious live-only case and giving
  `mockHost` a case for a live-only type each fail on the ledger's own assertion.

  `liveHost.ts`'s header claimed `OPEN_BUZZ_PURCHASE` was "the ONE capability live mode
  still cannot SERVE". That was already false when it was written — five other handlers
  refused — and it is now corrected to the full list, with the reason each one refuses
  ([#14](https://github.com/civitai/civitai-app-starters/issues/14)).

  ### The live picker no longer drops the required `modelType` (#391)

  `OPEN_RESOURCE_PICKER` with `resourceType: 'Checkpoint'` replied on
  `RESOURCE_PICKER_RESULT` with a `cardToCheckpoint()` projection — five fields, **no
  `modelType`** — while `BlockResourceInfo.modelType` is **required** and every consumer
  reads it. The overlay branched its converter on the picker's REQUESTED TYPE
  (`opts.type === 'Checkpoint'`), never on the channel it was replying to, and the live
  host never passed the channel down at all.

  The fix separates the two facts rather than patching the symptom: the reply channel now
  travels with the request (`OpenPickerOptions.resultChannel`, required) and `selectCard`
  branches on THAT. `cardToResource` already resolved `modelType` correctly — preferring
  the card's own REST-reported type, falling back to the requested type — so a Checkpoint
  asked for on the resource channel now comes back `modelType: 'Checkpoint'`.

  **This is now a compile error, not just a test.** `PickerSelection` is discriminated by
  `channel` and keyed to the shape that channel's consumers expect, so reintroducing the
  bug — pairing `RESOURCE_PICKER_RESULT` with a `BlockCheckpointInfo` — fails `tsc` with
  `Property 'modelType' is missing in type 'BlockCheckpointInfo' but required in type
'BlockResourceInfo'`. Measured, by reapplying the original branch.

  🔴 The compiler covers ONE direction. The mirror mistake — a `BlockResourceInfo` sent
  down the CHECKPOINT channel — is structurally assignable and `tsc` reports nothing
  (measured: 0 errors). A runtime test pins that half instead, asserting the
  checkpoint-channel payload still has exactly its five keys. The two channels keep two
  contracts; they were deliberately not collapsed into one shape.

  `PickerSelection`'s discriminant changed from `kind` (`'Checkpoint' | 'LORA'`) to
  `channel`. Both it and `OpenPickerOptions` live in `src/internal/` and are not part of
  any published subpath's export surface.

- 4e905e5: `SettingsForm` now tracks its props instead of seeding once on mount, and `liveHost.ts`'s
  header enumerations are measured rather than typed (#396, #387).

  **MINOR, not patch.** #396 is a bug fix, but it changes two things a consumer can observe
  and may have built around, so it is not a silent repair:

  - `initialValues` goes from **mount-only to live**. Passing a new object after mount now
    re-seeds every visible field the user has not edited. A host that deliberately mutated
    the prop between renders while relying on the form ignoring it will see different
    values on screen.
  - **The submitted key set is now scoped to the current `forScope` slice.** `onSubmit`
    previously received whatever keys were visible at MOUNT; it now receives exactly the
    keys visible NOW. A host reading a key outside the current slice off that payload will
    find it absent.

  The defects both came from one cause: `values` was a `useState` lazy initializer (runs
  exactly once) while `visibleFields` was a `useMemo` (recomputes). They drifted, two ways:

  1. **Async `initialValues` were dropped.** The normal shape is `{}` while a fetch is in
     flight, then the stored row. The form rendered manifest defaults for ever, and Save
     wrote those defaults back **over** the user's stored value.
  2. **A `forScope` flip submitted the wrong slice.** Flipping `publisher` → `viewer` on a
     mounted form recomputed `visibleFields` to the viewer slice while `values` still held
     the publisher keys — so the viewer fields rendered blank (the manifest `default` was
     skipped, the seed had already run) and `onSubmit` posted the **publisher slice's keys
     under a viewer-scope save**.

  `values` is now derived — a re-seed from `(visibleFields, initialValues)` overlaid with
  the user's own edits — so (1) fixes itself and (2) is closed **structurally**: the merge
  walks the seed's keys, so a key outside the current slice has no path into the submitted
  object at all, whatever is left in edit state.

  #387 is documentation and a guard, no runtime change. `liveHost.ts`'s header claimed "the
  only network it does is (a) `GET /api/v1/blocks/me` and (b) the four
  `blocks.{estimate,submit,poll,cancel}Workflow` tRPC mutations" while the file called 29
  tRPC procedures — several of them documented twenty lines further down in the same
  header. That claim is replaced by a description of the two real fetch chokepoints plus a
  `--- BEGIN DERIVED ---` block that `tests/guards/livehost-header-enumerations.test.mjs`
  regenerates from the source and asserts, so the counts cannot go stale again unnoticed.
  The refusal bullet list under SCOPE is pinned the same way, by set equality against the
  handlers that actually refuse.

### Patch Changes

- 6317fca: One predicate decides `requestId` routability, in one place (#395).

  **`patch`, and the reasoning is the interesting part.** Nothing is added to or
  removed from the published surface — `isRoutableRequestId` / `isWireRequestIdShape`
  live in `src/transport/requestId.ts` and are deliberately NOT re-exported from the
  entry. Every validator behaves exactly as before. Two behaviours _did_ move, and
  both are on values the SDK itself cannot produce (`sendRequest` always assigns a
  non-empty id from `nextRequestId()`), reachable only by a hand-built message or a
  buggy peer:

  - **The dev/mock hosts now decline a request carrying `requestId: ''`** instead of
    answering it with an equally uncorrelatable `requestId: ''` reply. The block's
    end state is unchanged — that reply never settled anything and the request timed
    out either way — so this removes an unroutable message from the wire rather than
    changing an outcome.
  - **A non-string `requestId` is no longer echoed onto `TOKEN_REFRESH_RESPONSE`.**
    The old `...(requestId ? { requestId } : {})` was a _truthiness_ test, so a
    numeric id was spread straight back — and then failed the block's own
    `isValidTokenRefreshResponse`, dropping the whole message _including the token
    update it exists to deliver_. The field is now omitted and the message validates.
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
  differing on `null` were TYPE ANNOTATIONS on the _payload_
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

- bcc24bf: Publish first-party deps as caret ranges instead of exact pins, and stop shipping sourcemaps that cannot resolve their sources (#374, #376).

  **#374 — exact inter-package pins duplicated `@civitai/theme` and `@civitai/components`.**
  `@civitai/components`, `@civitai/components-react` and `@civitai/blocks-react` declared
  their first-party deps as `workspace:*`. pnpm rewrites the workspace protocol at pack
  time, and `*` publishes an **exact** pin — measured off the real tarballs:
  `@civitai/components@0.4.2` shipped `"@civitai/theme": "0.3.1"`, not `"^0.3.1"`.

  Two exact pins from two different releases can never intersect, so co-installing
  adjacent releases produced duplicate physical copies. Measured outside this workspace
  with a real `npm install --package-lock-only` over a closed registry built from the
  actual packed tarballs — an app on `@civitai/components-react@0.4.0` that also pulls
  `@civitai/blocks-react@0.56.1`:

        before   @civitai/theme       0.3.0 (nested) + 0.3.1  — 2 copies
                 @civitai/components  0.4.0 (nested) + 0.4.2  — 2 copies
        after    @civitai/theme       0.3.1                   — 1 copy
                 @civitai/components  0.4.2                   — 1 copy

  That is not only bloat. `injectTokens()` is DOM-marker idempotent and **first copy
  wins**, so the first token bump that changes a _value_ would have shipped stale tokens
  underneath new component CSS — silently, and only in the duplicated install.

  The three manifests now use `workspace:^`, which publishes `^<version>`.

  **Scope of the fix, stated rather than implied.** `^` on a `0.x` version locks the
  minor, so this removes duplication across patch-adjacent releases only. Measured at
  the second point too: an app on `@civitai/components-react@0.3.1` (theme `0.2.1`)
  alongside `@civitai/blocks-react@0.56.1` (theme `0.3.1`) still resolves 2 copies,
  before and after. That is correct and deliberate — a `0.x` minor is a breaking change
  under this repo's own convention, so those two releases genuinely disagree about which
  theme they need, and widening the range to `>=x.y.z <1.0.0` would trade a duplicate
  copy for an incompatible pairing of component CSS with theme tokens.

  One consequence worth knowing at release time: because `^0.3.1` already admits
  `0.3.2`, `changeset version` no longer cascades a re-release of every dependent on a
  theme patch bump (verified against both manifest shapes — with `workspace:*` a theme
  `0.3.1 → 0.3.2` bump dragged `@civitai/components` and `@civitai/components-react` to
  `0.4.3`; with `workspace:^` it leaves them at `0.4.2`).

  **#376 — every shipped sourcemap dangled.**
  All five packages build with `sourceMap` + `declarationMap`, so `dist/` fills with
  `*.js.map` and `*.d.ts.map` whose `sources` point at `../src/*.ts`. No package lists
  `src` in `files`. Measured off the real packed file lists at the previous state: **270
  shipped maps, 270 dangling source references, zero resolvable** — `@civitai/blocks-react`
  160, `@civitai/app-sdk` 46, `@civitai/components-react` 48, `@civitai/theme` 12,
  `@civitai/components` 4. A consumer's devtools loaded each map and then had nothing to
  show.

  The maps are now excluded from the tarballs (`"!dist/**/*.map"`) and still emitted into
  `dist/`, where they are _not_ dangling — inside this repo `src` sits right beside them,
  so go-to-definition from a starter still lands in the real `.ts`. **No consumer
  debuggability is lost, because there was none.** Shipping `src` instead was measured
  and rejected: `packages/civitai-blocks-react/src` alone is 879,895 B, in a package
  whose design constraint is that every app inherits its install graph.

  Tarball delta across the five packages: **−114,574 B gzipped, −580,786 B unpacked**
  (`@civitai/blocks-react` alone: −77,441 B gzipped, −413,492 B unpacked).

  Enforced going forward by `scripts/check-shipped-sourcemaps.mjs` (`pnpm
check:shipped-sourcemaps`), which reads the real packed file list and every real map's
  `sources` rather than grepping for the `files` entry — so shipping `src` or inlining
  `sourcesContent` satisfies it equally.

- Updated dependencies [bcc24bf]
  - @civitai/components@0.4.3
  - @civitai/theme@0.3.2

## 0.56.1

### Patch Changes

- 8b1c098: Stop shipping maintainer post-mortem prose in the published artifact.

  `package.json`'s `comment-peerDependencies` array was 142 lines — 10,574 B of a
  12,734 B `package.json`, 83% of a file npm downloads on every install (#375).
  The prose moved to `PEER_FLOOR.md`, which this package's `files` field excludes
  from the tarball; the key stays as a one-line pointer, and a guard caps the total
  serialized size of every `comment*` key at 500 B so it cannot regrow. The
  published `package.json` drops from 12,734 B to 2,429 B.

  `README.md`'s version-compatibility table also asserted a current
  `peerDependencies` floor (`>=0.29.0 <1.0.0`) that `package.json` has contradicted
  since #309/#317/#344/#371 moved it to `>=0.49.0 <1.0.0`, together with a "npm
  will not warn you" claim that is now false in the other direction (#383). Both
  rows are scoped to the versions they describe; the README no longer states a
  current floor at all — `package.json` carries it.

  No behaviour, API or peer-range change.

## 0.56.0

### Minor Changes

- d057664: **App Storage rejections now carry the host's own message, in the mock as well as in production.** The wire has never carried `PAYLOAD_TOO_LARGE` — that is the TRPC _code_, and the host's bridge forwards `err.message`. `createMockHost` emitted the code anyway, the contract doc described it, and the `kv-storage` example branched on it, so a block's error handling passed every local run and took the wrong branch live. Closes [#343](https://github.com/civitai/civitai-app-starters/issues/343).

  ### Measured

  `civitai/civitai` `main`, read 2026-09-20 via `gh api`. `src/server/routers/apps.router.ts` has five **`PAYLOAD_TOO_LARGE`** rejection sites, each with a distinct message:

  | site                        | message                                                  |
  | --------------------------- | -------------------------------------------------------- |
  | `:568` per-value cap        | `` `value exceeds ${PER_VALUE_BYTE_CAP / 1024}KB cap` `` |
  | `:783` app byte umbrella    | `app quota exceeded`                                     |
  | `:791` app row umbrella     | `app row limit exceeded`                                 |
  | `:845` per-user byte budget | `per-user storage quota exceeded`                        |
  | `:853` per-user row budget  | `per-user row limit exceeded`                            |

  and `src/components/AppBlocks/IframeHost.tsx:282` (same pair in `PageBlockHost.tsx`) returns `err.message` when it is a non-empty string, else `'storage request failed'` — a **sixth** string, reachable on reads and deletes too.

  🔴 **Those six are the `PAYLOAD_TOO_LARGE` family plus the bridge's fallback — not every string a block can receive, and not even every ceiling — and this changeset deliberately does not list the rest.** `storageErrorMessage(err)` is called from _blanket_ `catch (err)` arms (`IframeHost.tsx:2395` GET, `:2427` SET, `:2458` DELETE, `:2508` LIST, `:2535` QUOTA), so every rejection out of `apps.storage.*` arrives on the same `error` field — including tRPC's own zod input-validation messages, which never reach a handler at all. **All of them classify `null`.**

  🔴 **The six are a set this repository CHOSE, not a set the host guarantees closed.** The host enforces size ceilings zod-side too, which throw no `TRPCError` and so are invisible to a `grep "new TRPCError"` re-derivation: `const keyInput = z.string().min(1).max(200)` (`apps.router.ts:460`) on `get`/`set`/`delete`, and `prefix` ≤ 200 / `cursor` ≤ 400 / `limit` ≤ 200 on `list`. The **200-character key cap** is the one a real block hits with no local warning — nothing in this repo caps a key, so a key derived from a URL or a model name saves under `dev:mock` and fails forever live, classified `null`, where the recommended "try reloading" copy is permanently wrong. Recorded as [#370](https://github.com/civitai/civitai-app-starters/issues/370) and documented in `appStorageErrors.ts`, `messages.ts`, both READMEs, and the `kv-storage` example's `App.tsx`, where the "try reloading" copy actually lives.

  That claim is structural, and it is stated that way on purpose. Two earlier drafts of this section tried to enumerate the non-ceiling strings instead — the first missed the whole authorization family, the second added a table of eight and still missed four more (`Apps are not enabled`, thrown from two gates with one spelling: the `enforceAppBlocksFlag` middleware `.use()`d before `.input()` on all five storage procedures, _and_ `assertAppBlocksEnabledForTokenUser` at `:153`, which grepping the middleware name does not find; `block token subject could not be resolved`; `review token subject could not be resolved`; `Apps authoring is not enabled for this account`). The router carries **21** `throw new TRPCError` sites and **17** distinct messages. A third list would be the same mistake again, so the rule replaces it: _these six classify, everything else is `null`_ — true without enumeration, and still true after the host adds or rewords a message. Note it is deliberately **not** "every ceiling classifies" — see the zod caps above. The re-derivation recipe in `appStorageErrors.ts` beats any prose in this repo, but it is **necessary, not sufficient**: it greps `TRPCError` throws, so it cannot see a zod cap or the bridge's own fallback literal. The strings named anywhere in these docs are illustrations, never a bound.

  The consequence for block authors is the important part: **`null` does not mean "transient"**, and a `default:` arm that says "please try again" is wrong advice for an expired token or a revoked instance, which is the bucket's dominant production occupant. The docs, the `kv-storage` example and the `messages.ts` contract doc all say so now, and a test pins that a sample of known host strings classifies `null`.

  ### `@civitai/app-sdk` — new, additive (`minor`)

  `@civitai/app-sdk/blocks` gains the strings and the matcher, in a new `appStorageErrors.ts` next to `appStorageLimits.ts`:

  ```ts
  import { classifyAppStorageError } from "@civitai/app-sdk/blocks";

  try {
    await storage.set(key, note);
  } catch (err) {
    console.warn("[my-block] save failed:", err); // log the host's words
    switch (
      classifyAppStorageError(err) // never render them
    ) {
      case "value-too-large":
        return "That note is too long to save. Try shortening it.";
      case "user-row-limit":
        return "You have no note slots left. Delete one to make room.";
      case "request-failed":
        // The bridge's fallback — a transport fault. Genuinely retryable.
        return "Could not save that note. Please try again.";
      default:
        // `null`: an unknown ceiling, or (more often) an expired/revoked token.
        return (
          "Could not save that note. Try reloading the page — if that does " +
          "not help, storage may be unavailable for this app right now."
        );
    }
  }
  ```

  New exports from `@civitai/app-sdk/blocks`: `classifyAppStorageError`, the type `AppStorageRejectionReason`, and the four messages a mock host has to emit — `APP_STORAGE_ERROR_VALUE_TOO_LARGE`, `APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED`, `APP_STORAGE_ERROR_USER_ROW_LIMIT`, `APP_STORAGE_ERROR_REQUEST_FAILED`. Nothing is removed or renamed.

  🔴 **The public branching surface is the REASON, not the string**, so the barrel deliberately exports less than `appStorageErrors.ts` does. `APP_STORAGE_HOST_ERROR_MESSAGES` is **not** published: it would invite `MESSAGES.includes(err.message)` — equality against a frozen snapshot, which stops matching the day the host moves its per-value cap, i.e. the exact matcher shape this change exists to eliminate. `isAppStorageHostErrorMessage` (a thin `classify(…) !== null` whose only caller is the guard, which imports by file path) and the app-wide pair `APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED` / `APP_STORAGE_ERROR_APP_ROW_LIMIT` (no mock in this repo can emit them; a block reaches them through the `'app-quota-exceeded'` / `'app-row-limit'` reasons) stay module-internal for the same reason. Adding one to the barrel later is a `minor`; removing a published one is not.

  🔴 **The per-value message is DERIVED from `APP_STORAGE_MAX_VALUE_BYTES`, not written out.** It is a template literal on the host, so `'value exceeds 64KB cap'` is true only while the cap is 64KB — and a spelling that silently stops matching the host is this bug, again. A test feeds the builder a cap the constant cannot equal and watches the output move; `classifyAppStorageError` matches the per-value message as a **family** (`value exceeds <n>KB cap`) so a host that re-measures its cap still classifies against an older SDK.

  The `APP_STORAGE_SET_RESULT` contract doc in `messages.ts` and the `useAppStorage().set` doc now say the field is a host-authored **message**, name the ceiling set this module classifies (and say plainly that it is not a bound on what arrives, naming the zod key cap as the case it does not cover), and say not to render it to a viewer.

  🔴 **The "`getQuota()` is the authority" sentences are now scoped to the byte/row budget** — in the `blocks-react` README, the `kv-storage` README and the `useAppStorage` hook doc. They read as unrestricted before, and that is false for the key cap in a way a reader cannot recover from: the host's procedure returns exactly `{ usedBytes, rowCount, limitBytes, limitRows }`, so there is no key-length field for `getQuota()` to render and no quota reply that predicts the refusal. Each now names what it covers and points at the key cap for what it does not; the `getQuota()` doc says the reply carries those two ceilings and no others.

  ### `@civitai/blocks-react` — **BREAKING (minor, 0.x)** for tests that assert the old strings

  `createMockHost`'s storage rejections now draw from that module, chosen by which ceiling tripped:

  | gate                      | was                   | now                               |
  | ------------------------- | --------------------- | --------------------------------- |
  | `valueCapBytes`           | `PAYLOAD_TOO_LARGE`   | `value exceeds 64KB cap`          |
  | `quotaBytes`              | `PAYLOAD_TOO_LARGE`   | `per-user storage quota exceeded` |
  | `limitRows`               | `PAYLOAD_TOO_LARGE`   | `per-user row limit exceeded`     |
  | `failNext` (set + delete) | `STORAGE_UNAVAILABLE` | `storage request failed`          |

  A suite asserting `rejects.toThrow('PAYLOAD_TOO_LARGE')` or `'STORAGE_UNAVAILABLE'` against the mock goes red, and that is the point: those assertions were pinning a string production cannot send. Replace them with the exported constant, or with `classifyAppStorageError`.

  Three notes on what the mock still cannot do. It models no app-wide umbrella ([#368](https://github.com/civitai/civitai-app-starters/issues/368)), so it never emits `app quota exceeded` / `app row limit exceeded` — both remain reachable only in production, and a block must still handle them. 🔴 Note the _direction_: the host enforces two gates the mock has none of, so this is a **permissive** divergence — a write the host would refuse succeeds under `dev:mock`. It also enforces no **key-length** cap where the host refuses a `key` over 200 characters ([#370](https://github.com/civitai/civitai-app-starters/issues/370)) — permissive for the same reason, and invisible to the `TRPCError` recipe because the host's gate is a zod bound. And lowering `valueCapBytes` does **not** change the message ([#369](https://github.com/civitai/civitai-app-starters/issues/369)): it still names the host's real cap, because that is the string a block has to match live.

  🔴 **Peer floor raised `>=0.47.0` → `>=0.49.0`.** `internal/mockHost.ts` value-imports four new peer symbols, and `changeset version` does not raise a floor that is merely too low (`onlyUpdatePeerDependentsWhenOutOfRange: true`). The same class shipped or nearly shipped three times before — #309, #317, #344.

  ### Guards

  - `tests/guards/app-storage-error-strings.test.mjs` — new. Every rejection `createMockHost` and the `kv-storage` harness can emit must resolve to a constant exported by `appStorageErrors.ts`. Asserted **positively** (membership), not as the absence of one word: banning the literal `PAYLOAD_TOO_LARGE` is walkable by typing any other invented string, so a string literal in an `error:` position is refused outright and what remains must name an exported constant.
  - `mockHostScenarios.test.tsx` — drives the mock past each of the three ceilings and asserts the three messages, that they are **distinct**, and that the shared classifier separates them. The distinctness half is what kills a mutant returning one constant from every gate.
  - The `kv-storage` example's `storageFailureMessage()` branches on `classifyAppStorageError` and spells no host string; a guard asserts both, and that its `default:` arm survives — the classifier answers `null` for a message it does not recognise, and the host can reword one in any deploy.
  - `#343` is deleted from the mock/host divergence ledger; #368, #369 and #370 — all three already true, all three previously unlisted — are added, so the ledger and both README caveats now say **five** known divergences. `app-storage-mock-divergences.test.mjs` records #368 and #370 as **PERMISSIVE** (the mock admits a write the host's app-wide gates, respectively its 200-char key cap, refuse), so the READMEs no longer claim #347 is permissive "alone among them".

## 0.55.1

### Patch Changes

- b22670b: Read the parent-origin allowlist env vars with **literal** keys instead of a computed
  `readEnv(key)` lookup. Two defects, in opposite directions, both invisible to a unit test
  that only asserts what `readAllowedOriginsFromEnv()` returns.

  **Leak.** `dist/internal/detector.js` read `import.meta.env?.[key]`. Vite substitutes
  `import.meta.env.SOME_LITERAL` at build time by static analysis; a computed key cannot be
  analysed, so Vite falls back to inlining the **entire env object** at the access site.
  Every `VITE_*` variable a block app defines — `VITE_LIVE_BLOCK_TOKEN` included — was
  therefore emitted into its production bundle. Reproduced against the published
  `@civitai/blocks-react@0.55.0` tarball and against a Vite 8 build.

  **Silent miss.** The same helper read `globalThis.process?.env?.[key]`. webpack/Next.js
  `DefinePlugin` replaces only the literal member expression `process.env.NEXT_PUBLIC_FOO`,
  and a browser bundle has no real `process` to fall back to — so
  `NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` resolved to `undefined` in a Next.js block app
  and the allowlist came back empty. The reads are now spelled bare
  (`process.env.NEXT_PUBLIC_…`), which is the form `DefinePlugin` actually keys on.

  No API change: `readAllowedOriginsFromEnv`, `BlockTransportDetector` and `DetectOptions`
  keep their exact shapes, the `VITE_` → `NEXT_PUBLIC_` → `PUBLIC_` precedence is unchanged,
  and the `try`/`catch` around each read still makes an absent `import.meta`/`process`
  non-throwing in both runtimes.

  Pinned by `test/detectorEnvBundle.test.ts`, which bundles the detector with Vite and
  asserts on the emitted JavaScript — a decoy env var must not appear in the output, and a
  companion positive-control bundle of the old computed-key read proves the harness can see
  a leak at all.

- Updated dependencies [e06173f]
  - @civitai/components@0.4.2

## 0.55.0

### Minor Changes

- f7e3be0: **BREAKING (minor, 0.x): `createLiveHost` and `LiveHostOptions` move off `@civitai/blocks-react/testing` onto a new `@civitai/blocks-react/live`.** Nothing is deleted; the import path changes (#334).

  ```diff
  -import { createLiveHost, type LiveHostOptions } from '@civitai/blocks-react/testing';
  +import { createLiveHost, type LiveHostOptions } from '@civitai/blocks-react/live';
  ```

  That is the whole migration. `./testing` is unchanged otherwise.

  ### Why

  `createLiveHost` is not a mock. It forwards the App-Block postMessage protocol to the **real Civitai backend** over a pasted short-lived dev block token, `blocks.submitWorkflow` included, and a successful generation **debits the token holder's own Buzz**. There is no dry-run mode and no confirmation.

  **The argument for the move, in full: a client that spends the caller's money should not be reachable through an import path named `testing`.** The import line is the one piece of context that travels with every call site, and `…/testing` actively asserts the opposite of what this module does. `./testing` can now state flatly that everything on it is a mock — a property of the subpath rather than a promise in a comment. That is #334's literal closing condition, and it is the whole of the case.

  **Two arguments made for this change do NOT hold**, recorded here so they are not made again:

  - **It does not shrink the install.** It adds 4,447 B — see below.
  - **It does not close a wrong-autocomplete hazard**, because there was none. `createMockHost(options: MockHostOptions = {})` is callable bare; `createLiveHost(options: LiveHostOptions)` takes a **required** argument whose `blockToken` is a **required** short-lived RS256 JWT a human mints and pastes by hand. `createLiveHost()` and `createLiveHost({})` do not compile. #334's Scenario A — a developer autocompleting the wrong one and billing their CI — cannot happen, and the "near-identical signatures" claim it rests on was asserted in six places by people who had not read the signatures.

  `createLiveHost` is no longer exported from `@civitai/blocks-react/testing`, and `test/subpathSurfaces.test.ts` asserts that absence _structurally_ — it walks `./testing`'s declared exports and fails if any of them resolves into `internal/liveHost.ts`, so re-adding it under a different name does not walk the check.

  ### 🔴 This makes #334 item 3 harder, not easier

  `./live` is now a **named, documented, published** entry point. #334 item 3 asks for the live-host code to leave the tarball entirely (a second package or a second artifact). Removing `./live` later is a breaking change on a surface consumers are now told to pin against; before this release the same code was one export among many on a subpath nobody was told to rely on. That cost is accepted here in exchange for the import-path signal, but it is a real one and it is not reversible for free.

  ### 🔴 Known impact — the Go CLI's scaffold template emits a broken import

  `civitai/cli`'s `page-money` scaffold template imports the moved symbol at
  `internal/scaffold/templates/page-money/src/dev-transport.ts.tmpl:13`:

  ```ts
  import {
    createLiveHost,
    resetTransport,
  } from "@civitai/blocks-react/testing";
  ```

  That template pins `"@civitai/blocks-react": "^0.53.0"`, and a caret on `0.x` pins the minor — so `civitai app init` keeps resolving `0.53.x` and **new scaffolds are unaffected until someone bumps that pin**. Whoever bumps it must split that import in the same change (`resetTransport` stays on `/testing`; `createLiveHost` moves to `/live`), or the CLI starts emitting projects that do not typecheck. Same applies to `mock-buzz.ts.tmpl:33` for the sibling `mockParentMessage` removal. Those fixes live outside this repo and are not made here.

  Fleet consumers of `createLiveHost` in app source, all four distinct shapes (a full enumeration of all 489 directories under the local `civit` tree, 27 repos, 81 sites — the rest are copies of these):

  | site                                                         |                  |
  | ------------------------------------------------------------ | ---------------- |
  | `starters/civitai-block-starter/src/dev/LiveHarness.tsx:3`   | fixed in this PR |
  | `civitai-app-panorama-360/src/dev-transport.ts:10`           | one-line change  |
  | `civitai-dogfood-app/*/src/dev-transport.ts:13` (4 sub-apps) | one-line change  |
  | `dogfood-app/dogfood-2/src/dev-transport.ts:13`              | one-line change  |

  None of them is reachable by this release without a deliberate bump: every `@civitai/blocks-react` range that governs a `./testing` importer anywhere in the fleet is a caret on `0.x` (which pins the minor), an exact pin, or `workspace:`. The one unbounded range in the tree (`>=0.33`, `civitai-app-panorama-360/packages/comfy-run-kit`) is an **optional peer of a sub-package that does not import the subpath at all**.

  ### What it does NOT do: shrink the install

  Measured with `pnpm pack` on both sides of the split — 319 → 323 entries, 1,590,099 B → 1,597,161 B uncompressed — and `liveHost.js` (86,688 B), `pickerOverlay.js` (29,508 B) and `catalog.js` (15,351 B) do not appear in the diff at all: **byte-identical and still in the tarball**. `files` is `["dist", "README.md"]` and `tsconfig` compiles all of `src/**/*`, so the `exports` map has no bearing whatsoever on what ships; it decides only what a consumer can _name_. The split in fact ADDS 4,447 B of code (`dist/live.*` +6,048, `dist/testing.*` −1,692, `package.json` +91).

  **The `/live` split buys safety, not size.** #334 item 3 (get the code out of the tarball — a second package or a second artifact) is still open and is not done here.

- bdf1289: **BREAKING (minor, 0.x): `@civitai/blocks-react/testing` drops 24 of its 46 exports.** The subpath is now 5 values + 17 types, documented in the README, and pinned by a ledger test that fails when the set grows _or_ shrinks (#334).

  `AGENTS.md` described this subpath as two "test-only helpers" and named a file that does not exist (`src/testing.ts`; it is `src/testing.tsx`). It actually exported 46 symbols, 41 of them undocumented anywhere — including `createLiveHost`, which is not a mock: it forwards the App-Block postMessage protocol to the **real Civitai backend** and a successful generation **spends the token holder's real Buzz**. Thirty-four of the 46 came from `src/internal/` under names generic enough to collide with a consumer's own (`DEFAULT_LIMIT`, `fetchCatalog`, `buildCatalogUrl`, `openPickerOverlay`).

  ### What it exports now

  **Values (5)** — `resetTransport`, `createMockHost`, `readMockHostUrlOptions`, `Harness`, `createLiveHost`.

  **Types (17)** — `HarnessProps`, `LiveHostOptions`, `MockHost`, `MockHostOptions`, `MockHostScenarioPatch`, `MockHostFailMode`, `MockGenerationScenario`, `MockBuzzScenario`, `MockBuzzBalance`, `MockBuzzHandle`, `MockStorageScenario`, `MockSharedScenario`, `MockSharedSeed`, `MockCannedImageScan`, `CostSpec`, `ImageSpec`, `CannedPick` — the transitive closure that makes those five values nameable.

  ### Removed — diff your imports against this list

  The catalog client (16):
  `buildCatalogUrl`, `fetchCatalog`, `modelToCard`, `responseToPage`, `edgeThumb`, `cardToCheckpoint`, `cardToResource`, `filterCardsByFamily`, `CATALOG_API_BASE`, `CATALOG_API_BASE_BLOCKS`, `DEFAULT_LIMIT`, `CatalogQuery`, `CatalogCard`, `CatalogPage`, `CatalogResult`, `CatalogModelType`.

  The in-harness picker overlay (4):
  `openPickerOverlay`, `PickerOverlayHandle`, `PickerSelection`, `OpenPickerOptions`.

  Other (4):
  `decodeBlockTokenPayload`, `disallowedAccountError`, `mockParentMessage`, `MockHostProvider` (it was an alias of `Harness` — use `Harness`).

  Twenty-two of the 24 are internal wiring for the mock/live hosts with no documented contract and no consumer anywhere in the fleet. There is no replacement import path: they are not published. If you depend on one, open an issue rather than reaching into `dist/internal/`.

  ### Known impact — the two removals that DO have a consumer

  **1. `openPickerOverlay`.** `civitai-app-panorama-360` (`src/orch-host.ts:270`, a `await import()` inside `orch` mode) uses the in-harness overlay as a real, network-backed picker UI. Replace it with the host-mediated `useResourcePicker()` / `useCheckpointPicker()` hooks, which is what a non-harness block should be calling anyway. One repo, one site — the single most load-bearing misuse of this subpath in the fleet, and exactly the trap #334 describes.

  **2. `mockParentMessage`.** Two consumers, and the second one matters more than the first:

  - `dogfood-app/dogfood-2/src/mock-buzz.ts:32` (import), dispatched at `:124`.
  - 🔴 **`civitai/cli`'s scaffold template** `internal/scaffold/templates/page-money/src/mock-buzz.ts.tmpl:33`. That template currently pins `"@civitai/blocks-react": "^0.53.0"`, and a caret on `0.x` pins the minor — so `civitai app init` keeps resolving `0.53.x` and new scaffolds are unaffected **until someone bumps that pin**. Whoever bumps it must fix this import in the same change, or the CLI starts emitting projects that do not typecheck.

  It was always a two-line `MessageEvent` constructor; inline it:

  ```ts
  function mockParentMessage(data: unknown, origin: string): MessageEvent {
    return new MessageEvent("message", { data, origin, source: null });
  }
  ```

  Nothing here breaks on `npm install`. Every `@civitai/blocks-react` range that governs a `./testing` importer anywhere in the fleet is a caret on `0.x`, an exact pin, or `workspace:` — none of them admits this release. The single unbounded range in the tree (`>=0.33`, `civitai-app-panorama-360/packages/comfy-run-kit`) is an **optional peer of a sub-package that does not import this subpath at all**. The break happens on a deliberate bump, and this list is what that upgrader reads.

  ### The fleet scan behind those numbers

  A full enumeration of **all 489 directories** under the local `civit` tree (not a sample), excluding `node_modules`/`dist`/build output: **1,800 files mention the subpath; 382 contain a real import; 10 distinct symbols are imported** (11 counting one that appears only in a README fence). Restricted to real app source — dropping agent worktrees, this monorepo's own clones, and the CLI's `.tmpl` scaffold files — that is **179 files across 27 logical repos**.

  | symbol                   | repos (app source)     |
  | ------------------------ | ---------------------- |
  | `createLiveHost`         | 27                     |
  | `resetTransport`         | 26                     |
  | `Harness`                | 25                     |
  | `MockSharedSeed`         | 8                      |
  | `createMockHost`         | 7                      |
  | `MockHostOptions`        | 5                      |
  | `readMockHostUrlOptions` | 3                      |
  | `HarnessProps`           | 1                      |
  | `mockParentMessage`      | 1 (+ the CLI template) |
  | `openPickerOverlay`      | 1                      |

  There are **zero** namespace imports (`import * as …`) of this subpath anywhere, so the surface a consumer can be depending on is exactly the named set above.

  ### Stability, stated rather than invented

  Three signals used to disagree: the module header and `AGENTS.md` said "test-only, never in production", a starter and **27 fleet repos** imported it, and it ships in the production tarball. The tarball and the consumers win — it is documented, supported API.

  That is #334's _first_ branch ("add the missing 41 to the docs"), and only that branch. It is **not** marked `@internal`, and it is **not** given a stability promise stronger than the rest of the package: `./testing` is a normal subpath of a `0.x` package, on the same footing as `.` and `./ui`, where **a minor may break it**. What _is_ enforced is narrower and mechanical — the exported symbol _set_ cannot change silently. `test/subpathSurfaces.test.ts` fails on growth and on shrinkage, and fails again unless the README section it parses is updated to match. The _shapes_ of the mock-host option and result types are explicitly not frozen; the ledger asserts names, not shapes.

  ### Not fixed by this change — and not fixable by any export-list edit

  `./testing` still reaches six `dist` modules no other entry point does — 264,785 B of JS plus 75,258 B of `.d.ts` (`mockHost` 118,590, `liveHost` 86,688, `pickerOverlay` 29,508, `catalog` 15,351, `testing` 9,951, `consent` 4,697) — and they still ship in every install. Cutting the export list moved none of it, and **neither would moving a symbol to a different subpath**: `files` is `["dist", "README.md"]` and `tsconfig` compiles all of `src/**/*`, so the `exports` map has no effect whatsoever on tarball contents. Only deleting the code or publishing a second artifact moves those bytes. It is tree-shaken out of application bundles, so it is `node_modules` weight, not bundle weight.

## 0.54.0

### Minor Changes

- 192ea9b: App Storage: the real ceilings, written once, and the mock now ENFORCES the row limit

  Every documented and simulated source of truth in this repo put the App Storage
  quota **25x too high on bytes and 1000x too high on rows**. Worse, the mock
  host's _defaults_ carried those figures, so a block that exceeded the real limit
  ran perfectly under `dev:mock` and failed only in production.

  ## The numbers, confirmed

  The audit that found this could not verify the host's figures from this
  repository. They are now confirmed, from `civitai/civitai` `main` on 2026-09-19
  via `gh api` (not a local checkout), `src/server/routers/apps.router.ts`, blob
  `654f2d6`:

  ```ts
  const PER_VALUE_BYTE_CAP = 64 * 1024; // :172
  const USER_QUOTA_BYTES = 2 * 1024 * 1024; // :204
  const USER_ROW_LIMIT = 1_000; // :205
  ```

  and `getQuota` returns `limitBytes: USER_QUOTA_BYTES, limitRows: USER_ROW_LIMIT`
  — so those are exactly the numbers a block reads back.

  **What the old docs were quoting.** The host has a second, app-wide pair
  (`APP_QUOTA_BYTES` / `APP_ROW_LIMIT`) sitting above the per-viewer clamp; the
  repo's figures were those. They are real, but nothing reports an app's usage
  against them and the per-viewer clamp binds long first.

  ## Scope: the namespace and the budget are different

  The docs said "(block instance, user)" and then quoted a per-**app** ceiling.
  Both halves were describing something real, which is why the contradiction went
  unnoticed:

  - **Namespace** — rows are keyed `(block_instance_id, user_id, key)`. "Per
    (block instance, viewer)" is correct and unchanged.
  - **Budget** — the host's quota counter is keyed `(app_block_id, user_id)`, so
    the byte and row budgets are per **(app, viewer)**: every instance of one app
    shares one budget for that viewer.

  ## Written once

  New: `APP_STORAGE_MAX_VALUE_BYTES`, `APP_STORAGE_MAX_BYTES` and
  `APP_STORAGE_MAX_ROWS`, exported from `@civitai/app-sdk/blocks`. Their
  definition file is the only place any **runtime or documentation** site spells
  the figures, and it carries their provenance plus the `gh api` one-liner that
  re-derives them. (Not literally the only place in the repo: this changeset, the
  guard that enforces the rule, and future CHANGELOGs all quote them, as history
  and as test data must.) Nine files
  (the SDK message contract, `useAppStorage`, both dev hosts, two READMEs, the
  `kv-storage` example and its harness, and a test) now reference the constants —
  29 hand-copied literals removed.

  The app-wide umbrella is deliberately **not** exported and its value
  deliberately not written down: nothing reports usage against it, so a constant
  for it could only be used to build a UI that lies.

  ## The mock now fails on the row limit, where it used to pass

  `createMockHost`'s storage defaults ARE the production ceilings, and — the part
  that turns a docs bug into a shipped-block bug — the write path now **enforces
  the row limit**. It was reported by `getQuota` and enforced by nothing, so the
  ceiling a block reaches _first_ was invisible to `dev:mock`. The same gap
  existed in the `kv-storage` example's own harness and is fixed there too.

  The gate is `isInsert`-guarded, matching the host: a store sitting at the
  ceiling must still accept an **overwrite**, or an app whose UI has no delete
  affordance would be permanently stuck with no way back under the cap (only the
  owning viewer may delete their own rows).

  This closes one gap; it does not make the mock gate-for-gate identical to the
  host, and the docs no longer claim it is. **Three** divergences are known and
  filed:

  - the error string a rejection carries (#343);
  - the byte gate's SHAPE — the host's is `!isNonIncreasing`-guarded, the mock's
    is not, so `dev:mock` still refuses a shrinking overwrite production admits
    (#345);
  - the byte gate's UNIT — the mock counts **wire** bytes
    (`TextEncoder(JSON.stringify(v)).length`), the host counts **stored** bytes
    (`octet_length(value::jsonb::text)`), which is larger for every container
    because `jsonb`'s canonical text inserts a space after each `:` and `,` (up
    to ~1.4999x for a long array). So the mock's budget is up to half again too
    generous (#347).

  🔴 **The third one runs the other way.** #343 and #345 are RESTRICTIVE — the
  mock shows a failure or a wrong string where production would be fine. #347 is
  **permissive**: a block can pass `dev:mock` and be rejected in production. That
  is the shape of the very bug this release exists to end, so it is called out
  rather than batched — and the unit fact behind it is one this diff already
  relies on, in `mockHost.ts`'s reason for not fixing #345. The conclusion had
  simply never been drawn for the budget gate.

  ## The `@civitai/blocks-react` peer floor moves 0.45.0 → 0.47.0

  `internal/mockHost.ts` now VALUE-imports `APP_STORAGE_MAX_BYTES`,
  `APP_STORAGE_MAX_ROWS` and `APP_STORAGE_MAX_VALUE_BYTES`, which first ship in
  the `@civitai/app-sdk` minor this changeset publishes. Left at `>=0.45.0`, the
  range admitted the published `0.46.0` — which has none of them — with no peer
  warning at all, and `@civitai/blocks-react/testing` then died at module
  evaluation:

  ```
  SyntaxError: The requested module '@civitai/app-sdk/blocks'
    does not provide an export named 'APP_STORAGE_MAX_BYTES'
  ```

  Measured against the real tarballs: the main entry still resolves (61 exports),
  so the failure lands on every dev harness and downstream test suite rather than
  on the block. This is the third time the class has come up (#309, #317), so the
  floor's derivation — `changeset status --verbose` on this branch, plus the
  measurement in both directions — is recorded in the package's
  `comment-peerDependencies`, and `tests/guards/blocks-react-peer-floor.test.mjs`
  now fails when the declared range admits an app-sdk version that lacks the
  constants. Note `changeset version` cannot fix this: with
  `onlyUpdatePeerDependentsWhenOutOfRange` a floor that is too LOW is still
  satisfied, so it is left alone and ships stale.

  ## 🔴 BREAKING FOR CONSUMERS OF `@civitai/blocks-react/testing` — a `minor`, not a `patch`

  `createMockHost` is published. This changes its **defaults** and adds a
  **rejection** to its write path, so a downstream block's existing test suite can
  go green → red with no change on its side:

  - `storage.limitRows` defaults from **1,000,000 to 1,000**, and is now enforced.
    A test that seeds or writes more than 1,000 distinct keys now gets
    `{ ok: false }` on the 1,001st INSERT where it previously got `{ ok: true }`.
  - `storage.quotaBytes` defaults from **50 MB to the per-viewer clamp** (25x
    smaller). A fixture holding more than the clamp now trips the byte gate.
  - A snapshot or assertion that pins `getQuota()`'s `limitBytes` / `limitRows`
    against the old defaults now reads different numbers.

  **That is the intended behaviour** — every one of those suites was green against
  a simulation 1000x more permissive than production, which is precisely the
  failure this release exists to end. But it is a behaviour change to a published
  API's observable output, so it ships as a `minor` rather than a `patch`.

  **To restore the old behaviour in a test that needs it** (e.g. a deliberate
  high-volume fixture), pass the ceiling explicitly:
  `createMockHost({ storage: { limitRows: 1_000_000, quotaBytes: 50 * 1024 * 1024 } })`.
  Prefer fixing the fixture: if the block really writes that many rows, it will
  fail in production too.

  ## Not changed: the error code

  The issue proposed splitting `PAYLOAD_TOO_LARGE` into a distinct
  `ROW_LIMIT_EXCEEDED`. Declined, and the reason is measured: the host returns
  `PAYLOAD_TOO_LARGE` for **all five** rejection sites. Inventing a code
  production never emits would make the mock diverge from the host in exactly the
  direction this change exists to close. The docs now say instead that a
  rejection does **not** imply the value was too big — the row ceiling has nothing
  to do with the size of the value being written.

  (Separately measured while confirming the above: the host bridge forwards the
  TRPCError's _message_, not its code, so a block actually receives strings like
  `per-user row limit exceeded`. Our docs and mock both say `PAYLOAD_TOO_LARGE`.
  That is a real divergence, it is a different defect from this one, and it is
  filed as #343 rather than batched here. The contract comment and the mock's
  docs now scope the "you cannot tell which ceiling tripped" statement to the
  MOCK and point at #343, so nobody writes a single generic retry arm on the
  strength of a claim we have already measured to be false of the host.)

### Patch Changes

- c577f71: `isSignedIn(viewer)` — the sign-in gate, spelled once in the SDK

  **New export:** `isSignedIn` from `@civitai/app-sdk/blocks`, alongside
  `isModelSlotContext` / `isPageSlotContext`. This is a MINOR (new public value
  export), not a patch.

  ```ts
  import { isSignedIn } from "@civitai/app-sdk/blocks";
  const { viewer } = useBlockContext();
  return <p>{isSignedIn(viewer) ? "signed in" : "anonymous"}</p>;
  ```

  **Why a function instead of a documented expression.** The gate was spelled in
  six places — `ViewerInfo`'s doc, the `blocks-react` README, the block-starter's
  `AGENTS.md`, two reference `App.tsx` files, and a repo guard — and the right
  spelling had already changed once (`viewer !== null` → `viewer?.signedIn ===
true`) as `civitai/civitai#3707` landed. Every one of those sites is COPIED by
  `tiged` into somebody's app, so each change of mind has to be chased through
  every copy ever made. One named predicate makes the next change a version bump
  instead of an archaeology exercise.

  **What it does, and why.** `isSignedIn` answers from PRESENCE
  (`viewer !== null && viewer !== undefined`), not from the `signedIn` flag.
  Three measured reasons, all of which point the same way:

  1. `signedIn` is `signedIn?: true` — OPTIONAL, and it must stay optional so the
     older payload shapes keep compiling. Against a host that omits it,
     `viewer?.signedIn === true` reads `false` for a viewer who IS signed in.
  2. Presence is what the trust boundary actually enforces.
     `isValidBlockInitPayload` pins `viewer` as object-or-null — a compatibility
     floor compiled into every already-deployed block bundle — and in the same
     guard, deliberately, does **not** reject a malformed `signedIn`, because
     failing the whole init over one advisory flag would cost the block its token,
     context and settings. A gate on `signedIn` is a gate on the one viewer
     property nothing validates.
  3. That guard names the future host mistake it refuses to brick for:
     `signedIn: !!user`. Under it, a flag-reading gate shows a sign-in CTA to
     someone already signed in; presence still answers correctly.

  The stated reason to prefer `signedIn` — that it outlives the `@deprecated`
  `id`/`username` — is delivered in full here: `isSignedIn` reads neither field,
  so nothing written through it changes when they are removed. That was the real
  requirement; reading `signedIn` was the weaker way to meet it. The field stays
  on `ViewerInfo` and stays on the wire; it is what this function would switch to
  if presence ever stopped meaning sign-in.

  **Docs corrected.** `civitai/civitai#3707` merged **2026-08-07**. Seventeen
  sites across both packages and two reference starters still asserted it was
  "OPEN and unmerged", including four occurrences inside `@civitai/app-sdk`'s
  published `dist/blocks/types.d.ts` — i.e. in the editor tooltip an author hovers
  while deciding which gate to write. Re-verified against `civitai/civitai` `main`
  (via `gh api`, not a local checkout): `src/components/AppBlocks/projectBlockInit.ts`
  exports `withSignedInFlag()`, which returns `null` for an anonymous viewer and
  `{ id, username, signedIn: true }` otherwise, from BOTH host surfaces
  (`IframeHost` and `PageBlockHost`); that repo's contract test pins
  `Object.keys(viewer).sort()` as exactly `['id', 'signedIn', 'username']` with
  the value literally `true`.

  **And the defect that made the whole question live.** All seven starter dev
  harnesses hand-build their `BlockInitPayload` (they do not go through
  `createMockHost`, so the existing `DEFAULT_VIEWER` fence could not see them) and
  every one posted `viewer: { id: 2, username: 'dev-viewer', status: 'active' }`.
  That is wrong in both directions at once: it OMITS `signedIn`, which production
  always sends, and it ADDS `status`, which the platform deliberately withholds
  from third-party iframes (civitai #2521) — so a block reading `status` passes
  every local run and gets `undefined` in production. All seven now post
  `{ id, username, signedIn }`.

  Also corrected: the `useBlockContext` JSDoc example rendered
  `viewer?.username ?? 'anon'` — an identity read on a `@deprecated` field
  standing in for a presence check.

  Two repo guards (not shipped in either package) hold the class rather than this
  instance: `tests/guards/civitai-pr-status-claims.test.mjs` fails on any source
  comment asserting a `civitai/civitai#NNNN` is open, unmerged or abandoned, and
  `tests/guards/starter-signin-gate.test.mjs` pins every starter harness's viewer
  key set against `createMockHost`'s `DEFAULT_VIEWER` (a relationship, so neither
  side can move alone) and requires every starter that reads `viewer` to gate
  through `isSignedIn` rather than open-code it.

## 0.53.1

### Patch Changes

- 2ffdbc3: useBlockResize: observe a root element that mounts on a later render

  The effect's dependency array was `[ref]` — the ref **wrapper**, which
  `useRef` keeps stable forever. So the effect ran exactly once, on the first
  render, found `ref.current === null`, and was never re-run. Every block renders
  a skeleton until `BLOCK_INIT` lands, which means the root the hook is asked to
  observe does not exist on that first render: the `ResizeObserver` was never
  created and the host was never told to size the iframe.

  The hook now keys on the **observed element**. Note the mechanical difference
  from `useBlockBreakpoint`, which solves the same problem by comparing
  `ref.current` read during render: that works there because the hook re-renders
  its own caller. `useBlockResize` re-renders nobody, and React attaches a ref
  during _commit_ — after the render that mounts it — so a dependency read during
  render is one render behind with no further render coming. Measured: with
  `[ref.current]` as the dependency, a component that mounts its root on the
  second render still observes nothing. The effect therefore runs per render and
  does its own reference compare against the element it is already watching,
  rebuilding the observer only when that element actually changes.

  **This removes a constraint.** Blocks no longer need to pin the same `ref` to
  every branch of a loading/ready conditional. The starter and all six examples
  drop that workaround; the README and the "build your first app block" guide
  drop it from their snippets.

## 0.53.0

### Minor Changes

- e3a5374: Count validator rejections — the one App Blocks bridge silence the host cannot see.

  Four of the bridge's drop paths are host-side and counted since civitai#4946 (`civitai_app_block_bridge_messages_total` over `{handled, no_handler, rate_limited, deduped, no_token}`). This adds the SDK-side one: an inbound reply that fails `internal/validate.ts` is dropped with nothing but a `console.warn`, the block's pending request never settles, and the UI hangs to its request timeout with no network call and no host-visible error. The host cannot see it — the check runs in the iframe _after_ the host has already replied, so from the host's side the exchange reads `handled`.

  ⚠️ **"the fifth and final silence" would be an overstatement, so this does not claim it.** `IframeTransport.handleMessage` still drops silently, uncounted, in at least three more places: an origin mismatch and a non-object/non-string-`type` body both bare-`return` before any validator runs, and a WELL-FORMED reply whose `requestId` matches no pending entry — or matches one awaiting a different `responseType` — falls off the end of the function and hangs the request identically. This closes the one path card 625 names and the one that caused the 2026-09-18 incident; it is not an enumeration of the class.

  **It is the drop path with a confirmed production incident.** On 2026-09-18 `custom-generators` served _"Couldn't load your kept images just now."_ from relist until a human found it by hand: since civitai#4895 a viewer's own unrated image returns `visible + ratingPending` with no `nsfwLevel`, `isValidGatedImage` still required the level, `isValidImagesResult` failed the whole reply on one entry, and `GET_IMAGES_BY_IDS` hung to its 30s timeout — while `civitai_app_block_renders_total` read `result=ok, error_class=none` throughout, because that metric fires once per mount and is blind to anything after ready. (The validator itself was fixed in #307; this is the instrumentation that would have surfaced it in a scrape interval instead of 15 days.)

  **`@civitai/app-sdk`**

  - New fire-and-forget block→host message `BLOCK_MESSAGE_REJECTED`, payload `{ type }`. No `requestId`: it reports a drop that already happened, so there is nothing to correlate and nothing to reply to.
  - New `BLOCK_TO_PARENT_MESSAGE_TYPES`, `OTHER_MESSAGE_TYPE_LABEL` and `boundBlockToParentMessageType` — the runtime mirror of the `BlockToParentMessage` union plus its clamp, held to the union in both directions by a bidirectional `Exclude` gate in `messages.ts` and by a runtime test that re-derives the union from that file's own source.

  **`@civitai/blocks-react`**

  - `IframeTransport` posts `BLOCK_MESSAGE_REJECTED` at the drop site, naming the block→host request left hanging (`'other'` for a rejected host push, which hangs nothing). The `console.warn` stays and now names the TOP-LEVEL validator that rejected plus the request that will hang — not the nested helper, which no validator reports at runtime and which therefore remains unavailable from any surface.
  - **No emit budget, and no undercount.** Magnitude on this path is unbounded exactly as it already is for `no_handler` and `deduped`: the host consumes the report in its shared dispatcher ABOVE the 30 msg/sec limiter, so a report burns none of the budget `BLOCK_ERROR` needs, and the host's own `BRIDGE_MESSAGE_COUNT_MAX` plus the beacon's coalescing are what bound a flood. A cap here would have made a flood read _small_, which is the one shape of wrongness `bridgeLabels.ts` explicitly rejects.
  - Nothing is reported before `BLOCK_INIT`: with no `parentOrigin` a report could only be queued, and the host's ~400ms init retry makes that queue a producer with no consumer. The gap is already covered by `civitai_app_block_renders_total{result="timeout"}`.

  **`type` is the REQUEST type, not the rejected reply's,** and that is load-bearing rather than a preference: the host bounds its `type` label against the code-owned block→host inventory, which contains no `*_RESULT` key (measured: 0 of 46), so reporting `IMAGES_RESULT` would clamp to `'other'` server-side and collapse every rejection in the protocol onto one label.

  **Why `minor` for both.** Additive on the wire and in the type surface: a host that does not handle the new message records one `no_handler` and, because the payload carries no `requestId`, sends no NACK. Nothing that compiled before stops compiling. Consuming the count requires the mirrored civitai change (a sixth `outcome` value `validator_rejected`, the new type in `hostHandlerParity.ts`'s `INVENTORY`, and the dispatcher branch): civitai/civitai#4977.

  ⚠️ **There is NO publish-ordering hazard, and an earlier revision of this changeset claimed one.** It said the civitai change "must land before this publishes", because that repo's compile-time gate asserts every _published_ SDK block→host type is an `INVENTORY` key. The gate is real and one-directional as described, but it reads the **installed** package — and civitai pins `@civitai/app-sdk` at `^0.14.0`, lockfile-resolved to `0.14.0`, while npm latest is already `0.44.0`. Its `INVENTORY` therefore runs **24** keys ahead of what it compiles against — 46 keys on civitai `main` against the 22 members the installed 0.14.0 union declares. (Two earlier revisions got this wrong in different ways: "~22" was the union SIZE rather than the gap, and "25 / 47 keys" used the count from _this_ PR's array, which is 47 only because this change adds one — civitai `main` has 46 and does not yet carry `BLOCK_MESSAGE_REJECTED`.), and publishing cannot redden its `main`; only a dependency bump inside that repo can. Either order is safe. Verified against `package.json` and `pnpm-lock.yaml`, not inferred.

## 0.52.0

### Minor Changes

- e28b165: Correct the `@civitai/app-sdk` peer floor: `>=0.29.0` → `>=0.40.0`.

  The declared range was satisfied by app-sdk versions that do not export symbols this package imports, so installs warned about nothing and the failure surfaced at module evaluation in consumers — on one, as 27 of 43 test files collecting zero tests while the summary line reported no failures (#309). CI cannot see this: `pnpm.overrides` maps the peer to the workspace copy, so every in-repo typecheck is blind to what the range says.

  🔴 The floor is **0.40.0, not the 0.39.0 that issue asked for.** `effectiveBrowsingCeiling` arrives in 0.39.0, but `BlockCreatePostRequest`, `BlockCreatePostResult`, `BlockCreatePostHostError` and `BlockPostSource` arrive in 0.40.0, and there is no 0.39.x between them — measured by installing each published version and typechecking a consumer that imports every symbol this package takes from the peer. A fix landing the issue's own number would have closed it and stayed broken.

  Consumers on app-sdk below 0.40.0 will now see the peer mismatch their install should have reported all along — `npm install` fails `ERESOLVE` rather than warning. That is the correct outcome: those consumers are already broken at module evaluation. `^0.51.0` does not reach this version, so nobody is dragged into the break by a patch.

  The method for re-deriving the floor is recorded in this package's `comment-peerDependencies`.

## 0.51.0

### Minor Changes

- 4d5a27c: `BlockGatedImage`: an image nothing has rated yet is no longer reported as a maturity claim.

  `GET_IMAGES_BY_IDS` returned a two-member union, and `hidden` carried six different meanings — including _"the scan has not run yet"_. A block holding `{ status: 'hidden' }` could not tell "a rating exists and it is not for you" from "nothing has been decided", so it guessed, and it guessed maturity: a user generated images in a full-page block, published them into the shared grid, and the grid rendered their own lighthouse as **"Hidden — rated mature"**. A full page reload showed it normally, because by then the scan had finished. Nothing had rated it.

  **The type change.** `nsfwLevel` and `contentRating` are now OPTIONAL on a `visible` entry, and a new `ratingPending?: true` marks the case they are absent for. The host returns that shape for the image's OWN AUTHOR only: the url, and no rating claim. 🔴 **A missing `nsfwLevel` is not "rated G".** Branch on `ratingPending` and render a "still processing" affordance; substituting a default rating is the bug this exists to stop. Breaking for any block that dereferenced those fields on a `visible` entry — `minor` because these packages are 0.x.

  **`status` is still exactly `'visible' | 'hidden'`, and the host deliberately will not tell you why something is hidden.** The server's per-row verdict does distinguish "unrated" from "above your ceiling", and it consumes that distinction on the author's path alone. Reporting it for someone ELSE's image would turn every remaining `hidden` cell into a positive assertion that a rating exists and is above your ceiling — letting a SFW viewer of a shared grid enumerate which cells are mature-or-flagged rather than merely unscanned. There is no third status and no way to ask.

  🔴 **`@civitai/blocks-react`'s transport validator is the load-bearing half of this release, not a follow-on.** `isValidGatedImage` REQUIRED `nsfwLevel` + `contentRating` on every `visible` entry, so the host's new owner projection failed the shape check and `isValidImagesResult` **dropped the whole reply** — every image in the batch, not just the pending one — leaving `getImages()` unresolved until the transport timeout. A block would hang rather than render. That is strictly worse than the bug the host change fixes, so shipping the host change without this one is not an option. Reproduced as a mutation: reverting `validate.ts` alone turns the new mock-host seam test into a 5-second timeout.

  The validator now accepts the pending shape and enforces that the two `visible` shapes are MUTUALLY EXCLUSIVE — a `ratingPending` entry that also claims a rating is rejected (a host asserting a rating it just said does not exist), and so is a `visible` entry with neither a rating nor the marker (a host that dropped the field, leaving a block unable to tell "unrated" from "missing"). Presence is tested with `in`, not truthiness, because `nsfwLevel` is a bitmask whose unrated value is `0`; there is a positive control for that.

  **`createMockHost`'s default gated projection now emits all three shapes**, including the author's own not-yet-rated entry. The previous default only ever produced rated `visible` cells, which is precisely the fidelity gap that teaches a block author to read `nsfwLevel` unconditionally, test green locally, and break in production. A new test in `mockHost.test.tsx` drives the real hook against the real mock and asserts the reply survives the real validator — a seam neither file's own tests could see, since `mockHost.test.tsx` never drove this bridge and `useGatedImages.test.tsx` only ever fed the validator hand-written fixtures.

  Co-requisite of civitai/civitai#4895, which vendors this exact declaration in `src/server/services/blocks/blockGatedImageSdkParity.ts` and fails its typecheck when the two disagree — so this type and that file now have to move together.

## 0.50.0

### Minor Changes

- 47c57df: Add `useCreatePostFromApp()` — publish a real, published Post on the viewer's
  profile from the app's own outputs, over the host-mediated
  `CREATE_POST_FROM_APP` → `CREATE_POST_RESULT` bridge.

  Requires `@civitai/app-sdk@^0.40.0` and the `posts:write:self` scope. 🔴 The
  `peerDependencies` floor stays the deliberately-wide `>=0.29.0 <1.0.0`, so npm
  will not warn you: pairing this with an older SDK fails at `tsc` with
  `Cannot find name 'BlockCreatePostHostError'`, not at install.

  Also lands:

  - the request is bucketed `'human'` (10-minute bound), because its reply waits on
    a host-chrome consent confirm — at the 30s protocol default it would reject
    with the dialog still open, and a viewer who then clicked Publish would get a
    real public post while the block reported a failure;
  - an inbound `CREATE_POST_RESULT` validator, wired into `payloadValidatorFor`.
    `error` is shape-checked and deliberately **not** membership-checked: the
    channel carries free-text server messages, and a dropped reply on a
    REQUEST-style message does not reject — it hangs the block for the full
    ten-minute bound;
  - `createPostResult` / `createPostError` scenario knobs on `createMockHost`.
    `dev:live` refuses this bridge on purpose (no civitai chrome to render the
    server-resolved confirm in).

  ⚠️ Posting a previously-published image **removes it from the app's own grid**:
  the app-scoped read behind `useGatedImages()` is conjoined with `postId IS NULL`.

## 0.49.0

### Minor Changes

- 17d3e45: Surface the viewer's own browsing level to blocks as `effectiveBrowsingLevel`.

  `BLOCK_INIT`'s `maxBrowsingLevel` is a property of the DOMAIN — every viewer on
  `civitai.red` receives the same maximally-wide ceiling, including one whose own
  NSFW setting is off — so it cannot answer "may I show THIS viewer mature
  content". The host now also projects `effectiveBrowsingLevel`: that ceiling
  intersected with the viewer's own browsing level.

  - `BlockInitPayload.effectiveBrowsingLevel` (optional, additive) + a validator
    shape check that rejects non-finite and NEGATIVE values.
  - `effectiveBrowsingCeiling(maxBrowsingLevel, effectiveBrowsingLevel)` exported
    from `@civitai/app-sdk/blocks` — resolves the pair, and can only ever narrow.
  - `useDomainMaturity()` now returns `effectiveBrowsingLevel`, and `isSfw` /
    `isLevelAllowed` (and therefore `<SfwGate>`) gate on it. A red-domain viewer
    who turned NSFW off now closes the gate.
  - `createMockHost({ viewerBrowsingLevel })` drives the new field, clamped to the
    resolved ceiling exactly as the real host clamps it.

  Upgrading is safe: against a host that does not send the field the gates read
  exactly what they read before, and against one that does the ceiling is an
  intersection — so an existing caller can only ever end up with the same or a
  NARROWER permission, never a wider one. The viewer's raw level is deliberately
  never sent (on `blue` it is wider than the domain permits).

  Requires the platform side to ship first; until it does the field is simply
  absent and every consumer falls back to `maxBrowsingLevel`.

## 0.48.0

### Minor Changes

- dde2677: Add the collection-follow host bridge (`SET_COLLECTION_FOLLOW` → `COLLECTION_FOLLOW_RESULT`), the `useCollectionFollow()` hook, and two shared `/ui` controls: `FollowButton` and `TipButton`.

  The host half already merged in `civitai/civitai#4666` (handlers in both real hosts plus the `hostHandlerParity` inventory entry, which explicitly permits a forward-looking entry ahead of the published SDK union). This is the SDK half that energises it: until it publishes, the bridge is inert.

  ## What the bridge is, and why it is a TIGHTENING

  A block could already follow a collection over HTTP — `POST /api/v1/blocks/collections/[id]/follow`, gated on the block scope `collections:write:self`. That endpoint stays live and is untouched.

  🔴 **The scope was never a consent step.** `collections:write:self` is listed in `CONSENT_EXEMPT_SCOPES` server-side (_"server visibility/ownership is the gate, not a per-scope consent prompt"_), `partitionByConsent` puts it straight into `signable`, and no grant row is ever recorded. So on HTTP a block that merely _declared_ the scope could follow arbitrary collections for the viewer with **zero prompts**, at install time or ever. The bridge converts a zero-prompt path into a **one-prompt-per-action** path.

  What it costs, precisely, is the manifest `scopes` declaration — the ex-ante reviewability signal a moderator reads before install and a viewer inspects afterwards. An app on the bridge declares no write scope, so its permissions panel can read empty while it writes to the viewer's collections. The real trade is **"reviewable before install" → "consented at the moment of action"**, and it is worth stating plainly rather than as a security win.

  The replacement gate is the platform's other consent idiom (the same one `PUBLISH_GENERATION_OUTPUTS` uses): a **host-chrome confirm**, which a sandboxed cross-origin block can neither fake nor restyle. It names the collection **the host itself resolved from `collectionId`** — there is deliberately no `name` field on the wire, because a block-supplied one would let a card reading "Follow ⭐ Cute Cats" post a different id with the host's own chrome vouching for it.

  ## `useCollectionFollow()`

  `{ setFollow, pending, error }`. No block scope and no token on the wire: the host calls the session-authed `collection.follow` / `collection.unfollow` procedures, whose handlers pass `ctx.user.id` as both actor and target, so `collectionId` is the only thing a block influences.

  🔴 **`SET_COLLECTION_FOLLOW` is bucketed `'human'`, not `'protocol'`**, so it carries the 10-minute consent bound rather than the ~30s default. The wrong bucket here is not merely slow — the request would reject **while the dialog is still open**, so a viewer who then clicked Follow would get a followed collection and a block showing a failure, with nothing to reconcile them. That is `civitai/civitai#4158`'s shape in the follow axis. The `satisfies Record<BlockToParentMessageType, …>` totality gate in `internal/requestTimeouts.ts` forced the decision at `tsc` time; the behavioural half of `humanGatedRequestTimeouts.test.tsx` drives it past 120s and settles it on a late reply.

  🔴 **The error channel is NOT a discriminated enum**, unlike `WILDCARD_PACK_RESULT`'s. It carries either one of six closed host refusal codes OR a free-text server message the host forwards verbatim (`err.message` from the collection service — e.g. a `FORBIDDEN` on a private collection). Three consequences, all load-bearing:

  - The transport validator gates `error` on **shape only**. A membership check would drop every server failure, and a dropped reply on a REQUEST-style message hangs the block to its 10-minute bound — turning a legible "you may not follow that" into a wedged button.
  - "Is this a code?" is therefore a runtime **membership** question, exported as `isCollectionFollowErrorCode` / `COLLECTION_FOLLOW_ERROR_CODES`. A `switch` over the union type would silently treat prose as unmatched while a typo'd literal compiled fine, and a `.includes()` implementation would misclassify _"the request was declined by the server"_ as the `declined` code.
  - `CollectionFollowError.code === undefined` is **not on its own** a server message worth showing — a transport timeout lands there too, with an SDK-internal `.message`. Check `.timedOut` first; `code === undefined && !timedOut` is the renderable branch. (This bullet asserted the opposite until an audit caught it — the correction is below.)

  Two codes are not failures to render, and they are the reason this is a shared hook rather than eleven hand-rolled ones:

  - **`declined`** — the viewer dismissed the confirm, so **no write occurred**. It is trustworthy in the direction that matters: the host takes its consent latch synchronously before the write, so it can never be reported for a follow that landed. Surfaced as `err.declined`.
  - **`sign-in-required`** — no session, so the viewer's next step is signing in, not retrying. Surfaced as `err.signInRequired`.

  🔴 **`collection-unavailable` deliberately means four different things** — does not exist, not visible to this viewer, the lookup failed, _and_ the block exhausted its per-instance budget of 20 distinct collection ids. A distinct "not found" would let a block enumerate private collection ids by asking the host to name them; a distinct "rate limited" would hand back exactly the bit the cap withholds. Do not branch on it for anything but "we cannot act on this id".

  `error: ''` is a valid reply and is mapped to a code rather than thrown as a blank message — `||`, not `??`, and the opposite choice from `useWildcardPack` for the opposite reason.

  ## `FollowButton`

  `collectionId` + `followed` (+ `onChange`, `collectionName`, `disabled`, `size`, `variant`). Flips optimistically, adopts the **host's echo** rather than its own guess, and reverts on failure. `declined` reverts **silently**; `sign-in-required` routes into `REQUEST_SIGN_IN`; everything else reverts with a `role="alert"` note — `aria-pressed` reverting is indistinguishable from never having pressed, so without the alert a screen-reader user is told nothing at all about the failure.

  The `followed` prop stays the source of truth. While a write settles the control asserts its own value, and on success it **holds the echo until `followed` agrees**, so it never blinks back to a stale server value while the parent catches up — including when `onChange` is omitted entirely.

  ## `TipButton`

  `toUserId` + `amount` + `noun` (+ `entityType`/`entityId`, `tipped`, `remaining`, `disabledReason`, `onTipped`).

  🔴 **Its confirm is the component's, NOT host chrome** — say that rather than implying platform mediation. `useTip` posts to the block-token-gated tip endpoint directly, so unlike the follow bridge nothing outside the iframe asks the viewer anything and a one-press money spend is reachable by construction. The two-step handshake is the only thing between a stray tap and a transfer.

  🔴 **It mints one idempotency key per logical tip and reuses it on retry.** This is the property a hand-rolled tip button most reliably misses: `useTip` mints a _fresh_ key per call when none is passed, so retrying after a response that was merely **lost** sends a second transfer — and from inside the block a lost response is indistinguishable from a rejection, which is exactly where the retry path lives. Changing the target or amount correctly mints a new key. The key is not rotated after a success, which is safe **only** because a settled control is terminal; a test pins that terminality, so making the settled state re-armable fails rather than silently double-charging.

  `remaining` is a **prop, not an internal `useTipAllowance()`** — this control is rendered per card, so fetching inside it would fan one screen out into N identical HTTP reads. Hold one allowance read in the view and pass it down.

  ## Dev hosts

  - `createMockHost` gains `collectionFollowError` (a code _or_ free text) and `collectionFollows` (seeded, mutable, merged by `setScenario`), and **mirrors the real host's payload gate** — a numeric-string id is refused as `invalid-request`, not coerced. Without that the mock would be more permissive than production and a block bug would work in `dev:mock` and fail live.
    🔴 What it structurally cannot prove: the consent dialog is host chrome, so the mock settles immediately where the real host waits on a click. Nothing exercises the _timing_ of a confirm — only the outcomes.
  - `createLiveHost` **refuses** with `collection-unavailable`, and the refusal is the point. That harness holds a block token and could call the legacy scoped HTTP endpoint — a path with no consent confirm — so routing to it would let dev prove out a flow production does not have, and a block would ship having never once handled `declined`. `sign-in-required` was rejected as the code because it would send a block into a `REQUEST_SIGN_IN` loop against a harness that has no sign-in.

  ## What an adversarial audit changed (round 1)

  The audit found **no 🔴 and five 🟡**, and four of the five were a CLAIM that was narrower or wider than the code under it — the same shape that made the host-side PR wrong. Recorded rather than quietly fixed:

  - 🔴 **`FollowButton` adopted a reply about the WRONG COLLECTION.** One mounted instance whose `collectionId` prop changed mid-flight (a rail showing "the currently selected collection", an unkeyed recycled row) adopted the OLD collection's reply as the new one's state and reported it through `onChange` — so the app recorded a follow the viewer never made, on an account-write control. Now correlated on the host's ECHOED `collectionId`, which `isValidCollectionFollowResult` already pinned to a positive integer _for exactly this_ and which no consumer read.
  - 🔴 **The guard that was supposed to cover it did not exist.** The control carried an attempt COUNTER whose comment claimed to close "a settle arriving after the parent moved `followed`" — but it was incremented only inside `toggle()`, so it could not observe the parent at all. **Deleting all three of its lines left the file's suite fully green**, which is how the false claim survived review. It is replaced by the correlation guard, which the suite pins: removing the correlation mechanism fails the cases named for it. 🔴 **No count is quoted here on purpose** — an earlier revision said "four", audit round 2 measured three and corrected it, and audit round 3 measured four again because round 2's _own_ new test had changed the answer. A number nothing asserts on drifts every time the tests move; the property is what is stable, so re-derive the count if you want it rather than reading it here.
  - 🔴 **`TipButton` could swallow a transfer that LANDED.** If the viewer cancelled, or the parent flipped `tipped`, while the POST was in flight, the success path was suppressed: `onTipped` never fired, so the allowance was never refetched and no `tipped` record was written — and the control could then re-arm over money that was already gone. Cancel resets this control's UI; it does not abort the POST. **A landed transfer is reported rather than swallowed**; only the FAILURE path respects supersession, because there nothing moved. _(This bullet said "unconditionally" and then "once per mount"; both were superseded — the shipped rule is once per idempotency KEY. See the round-2 and round-3 sections.)_ ⚠️ The previous revision had a test asserting the OPPOSITE (`onTipped` not called after a cancel) — it pinned the wrong proposition and has been rewritten.
  - **The idempotency key omitted `entityType`/`entityId`**, which are sent in the body and recorded on the transaction. Changing the entity after a failed attempt reused the key, so a deliberate tip to a DIFFERENT object was collapsed into the first. Under-charge rather than double-charge, but wrong.
  - **`.code === undefined` conflated a server message with a transport timeout**, and the README told blocks to render `.message` on that branch — which would put `IframeTransport: request … timed out after 600000ms` in front of a viewer. There is now a `timedOut` flag, set from a **typed** `RequestTimeoutError` rather than by matching the message wording. 🔴 It also does not mean no write occurred, and says so: the reply is what was lost, not necessarily the work.
  - **Two unvalidated numbers on the money control**: `amount={0}` rendered "Tip 0" and posted it, and `remaining={NaN}` made `amount > remaining` false — so an unusable allowance did not merely fail to block, it silently REMOVED the ceiling.
  - **The mock's `collectionFollows` option was write-only** — the reply echoes the request, as both real hosts do, so nothing could ever read the map. Seeding, mutating and merging it were no-ops; deleting it entirely left the whole suite green, and three claims about it (a JSDoc, a test name, a test comment) were false. **Removed rather than repaired**: there is no read op on this bridge for such a map to feed. A test now pins the stateless-echo property so re-adding one has to contend with a test rather than a comment.

  **Known and NOT fixed here**, so it is open rather than absent: the SDK's copy of the closed refusal-code set is pinned against a literal _in this repo_, so it cannot detect the host gaining a code (verified by hand today; the repo has a cross-repo drift-guard pattern this could adopt). And the two new `/ui` controls ship no `*.browser.test.tsx`, unlike `ReportButton` and `ResourceCard` — both compose already-covered primitives, so this is a convention gap.

  🔴 **Also surfaced, and it is a precondition this PR never stated:** the host half is on `civitai@main` but NOT on `origin/release`, and `release` is what builds production. So publishing this SDK is **not** the last gate — against today's production host a `FollowButton` press waits the full 10-minute human bound before failing. Nothing here adopts the controls, so nothing regresses; but "until this publishes, the bridge is inert" was only half the story.

  ## Audit round 2 — a regression the ROUND-1 FIX introduced

  The delta re-audit dispositioned all ten round-1 claims: seven fixed, three partial. The partials matter more than the count:

  - 🔴 **The round-1 fix made `onTipped` fire TWICE for one transfer.** "Report a landed transfer unconditionally" was right about the first POST and never considered the viewer retrying: Cancel does not abort POST #1, the retry sends POST #2 with the **same** idempotency key, the server collapses them into ONE transfer — and both promises resolve. Since `onTipped` is handed the amount precisely so a caller can decrement an allowance with it, that double-counts. The answer is **at most once**, held in a REF not in `done` (two promises resolving in one turn both read the same stale state). ⚠️ This round scoped it per MOUNT, which round 3 then found was wrong in the other direction — the shipped rule is once per KEY.
  - **The `amount` guard covered the ARMING path only.** The prompt stays mounted across a re-render, so a parent moving `amount` to `0` after the viewer armed the control left an enabled Send that posted it — and an amount switcher mid-handshake is a flow this component's own JSDoc contemplates. Re-checked at the spend.
  - **`!Number.isFinite(remaining)` swept together two OPPOSITE readings.** `NaN` is unusable and must block (every comparison against it is false, so it silently removed the ceiling); `Infinity` means the viewer has no limit, and blocking it refuses someone who is allowed everything. Now `Number.isNaN`.

  **Two guards were passing with no killing test**, both found by mutation rather than by reading:

  - The **echo half** of `FollowButton`'s correlation — mutating `stillOurs` to drop the id comparison left the _entire_ suite green, because the case named for it was killed by the sibling ref check. The echo half is the only defence against a host echoing an id it was not asked about.
  - `TipButton`'s **failure-supersession** guard — its test asserted only that the prompt was absent, which is true either way at that instant; a stale failure surfaces on the NEXT arm. The test now re-arms and reads the copy.

  Also corrected: the class JSDoc, the hook's `@example` and this file's own bullet each still instructed the behaviour the `timedOut` flag exists to prevent (an IDE surfaces the first on hover); a count here quoted a number of failing cases that turned out to depend on where you draw the guard's boundary (independent re-derivations got 2, 3 and 4), so it is gone rather than corrected; and `RequestTimeoutError` is now exported, since `sendTypedRequest` — which throws it — already was.

  🟢 **Stated, not fixed:** a `collectionId` round-trip (1 → 2 → 1) while a write for `1` is in flight discards the successful reply, so `onChange` never fires. That is the deliberate cost of releasing the in-flight marker on a prop change, and it is the mirror of the TipButton fix in the same PR — a landed write not reported. Reachable only from a control whose id oscillates during a consent dialog.

  ## Audit round 3 — the round-2 fix regressed the spend path, and inverted the money-report bug

  Round 2's own fixes produced two more, which is the third consecutive round where a fix round introduced the next finding.

  - 🔴 **The new spend-time gate read three of its four inputs through a STALE CLOSURE.** `confirm`'s dependency array listed `amount` but not `remaining`, `disabled` or `disabledReason`, so the gate decided a SPEND on frozen values — and there is no eslint in this repo to catch it. It failed in **both** directions: a parent topping up `remaining`, or clearing `disabled` (the "view still loading" usage this component's own JSDoc names), left Send **permanently refusing a perfectly good tip** with a message that is false about the amount; while the mirror cases the gate's comment claims to cover — the allowance dropping, a `disabledReason` appearing after arming — sailed straight through. 🔴 **It was consumer-dependent, which is why no test saw it:** an inline `onTipped={() => {}}` recreates the callback every render and hides it completely; a consumer doing the idiomatic `useCallback` gets the wedge. Every new case for it uses a **stable** `onTipped`.
  - 🔴 **"At most once per mount" was wrong in the OPPOSITE direction from the bug it fixed.** Cancel does not abort POST #1, so if the parent then moves the amount a **new** key is minted and the server does _not_ collapse the two — 150 Buzz moves while the app is told 50. Since `onTipped` is where a caller refetches the allowance and records its `tipped` flag, the second transfer left no record, re-creating the exact harm round 1 cited. Now scoped once per **key**.
  - **`Number.isNaN` does not coerce**, so the round-2 `!isFinite` → `isNaN` fix silently dropped the type check and let `remaining: 'abc'` through — removing the ceiling, the wrong direction, and precisely what the comment it replaced claimed could not happen. There are **three** cases here, not two: non-number and `NaN` block, `Infinity` does not.
  - Two comments the round-2 fix falsified are corrected in place rather than deleted: the JSDoc still said the success path "reports unconditionally", and the guard block still claimed `Number.isFinite` protected `remaining` from a non-number.

  ## Audit round 4 — clean on behaviour; the ladder stops here

  Round 4 independently re-derived every round-3 claim by mutation, **including a positive control the earlier rounds' framing lacked**: reverting the dependency array _and_ swapping the tests' stable `onTipped` for an inline lambda makes the suite pass again — proving the stale-closure bug is genuinely consumer-dependent and that the stable callback in those cases is load-bearing rather than decorative. It found **no behavioural defect in the shipped code**.

  What it did find was a comment asserting `"once per mount"` directly above the line that implements once per **key** — the class that regenerates the bug, since a maintainer reading it would collapse the `Set` back to a boolean and 31 of 32 cases would still pass. Fixed, and **the shape was swept rather than the site**: two further instances turned up in this file's own round-1 and round-2 sections, both stating a superseded answer in the present tense. They now say so.

  Also fixed while there: the spend gate emitted `"That amount cannot be sent."` for every refusal reason — false when the amount is fine and a real `disabledReason` is in hand, on a path round 3 had newly pinned. 🔴 **And the fix for that had its own defect, found by mutating it:** `disabledReason ?? …` renders a BLANK refusal for an empty-string reason, which still blocks (`blocked` tests `!== undefined`). `||`, not `??` — the same distinction as the error channel, three files apart.

  **🔴 THE LADDER STOPS HERE, AND WHY IT WOULD NOT STOP ON ITS OWN.** Round 4's remaining findings are prose, so every fix round rewrites prose and manufactures the next prose finding; and because these comments live in shipped source, the attribution gate ("two consecutive rounds changing zero payload lines") can never fire on them. The stated criterion: no 🔴 · no blast radius beyond "a comment contradicts its code" · and the recurring SHAPE swept at every site rather than only the reported one. A round 5 whose entire input is a reworded sentence has nothing behavioural to audit.

  **Left open, deliberately, so it is recorded rather than absent:** the changeset still quotes a count of killed mutants; the refusal-message change is pinned by three cases but not mutation-swept beyond the two directions above; and everything in "Not verified" below is unchanged.

  ## Verification

  Suite 1355 → 1441 unit + 73 browser, typecheck and build clean across all five packages, README snippet gate 45/45 (positive-controlled: a deliberate type error in the new snippet fails it).

  **44 mutants, 44 killed** (20 before the audits, then 11 / 6 / 4 / 3 on the fixes of rounds 1–4) — 🔴 one of round 4's SURVIVED first and was right to: it showed `??` blanking a refusal message, so the mutant's form was adopted, each by the test whose name states the property, none via an import failure, with a positive control proving the harness can go red: the timeout bucket, the hook's own `timeoutMs` opt-out (the reachability check — the ledger pin alone would pass for a request never wired), `??`-for-`||`, both refusal flags, a `.includes()` code check, an enum-only validator, the id-sign check, an unmapped `payloadValidatorFor` case, the echo-vs-guess adoption, the silent-decline branch, the sign-in routing, the optimistic flip, the allowance boundary (`>` vs `>=`), the idempotency key's amount component, a one-click tip, the mock's payload gate, a live host fabricating success, and dropping the message from the SDK union.

  **Not verified, and not claimed:** no end-to-end run against a real host. The blocks in this repo cannot reach one, and `civitai#4666`'s own browser tier mocks `trpc.useUtils()`, so no real `collection.getById` response has ever been observed on either side of this bridge. Failure modes degrade to refusals by construction, so the failure direction is safe, but the happy path's rendered content is unproven against production.

  ## Pairing

  `@civitai/blocks-react@0.48` needs `@civitai/app-sdk@>=0.38` — the hook imports `BlockCollectionFollowErrorCode` / `BlockCollectionFollowResult` from it. 🔴 The `peerDependencies` floor is deliberately NOT tightened: #206 widened it to `>=0.29.0 <1.0.0` precisely so an SDK minor stops forcing a major on consumers, and reversing that here would be a worse trade than the warning it buys. The consequence, stated rather than hidden: **npm will not warn about an under-paired install** — it fails at `tsc` with `Cannot find name 'BlockCollectionFollowErrorCode'`. The compat table in the README carries the pairing.

  Adopting these in the first-party blocks is deliberately not part of this change — each needs the published version first.

## 0.47.0

### Minor Changes

- c03b9da: Add `ResourceCard` to `/ui` — a presentational, stateless renderer for a picked Civitai generation resource (a checkpoint or a LoRA), in two variants: `variant="card"` (thumbnail-first tile for a picker/browse grid) and `variant="row"` (compact line for a list of already-selected resources).

  Derived from three first-party blocks that each built one independently: `civitai-app-gen-matrix` (`CardTile` — thumbnail, model name, base model, rendered as a `<button>` with `aria-pressed`, a disabled "already added" state), `civitai-app-model-benchmarking` (`CombinationForm` — compact rows showing `modelName ?? '#'+versionId` then `baseModel → <ecosystem>`, with a weight slider and a Remove button per LoRA), and `civitai-block-generate-from-model` (an inline "Generating with: **Name (Version)**" plus a Change link). The first is the `card` shape; the other two are `row`. Adopting it in those apps is deliberately NOT part of this change — each needs the published version first.

  🔴 **`BlockResourceInfo` carries NO image field.** Measured against `packages/civitai-app-sdk/src/blocks/types.ts`: it declares `versionId`, `modelId`, `modelName`, `versionName`, `baseModel`, `modelType` plus the optional recommended-settings projection (`strength`, `minStrength`, `maxStrength`, `trainedWords`, `clipSkip`), and nothing image-shaped. The host's resource picker does not return a thumbnail. Three consequences, and they shape the whole component:

  - `thumbnailUrl` is an OPTIONAL prop the caller supplies from its own source (gen-matrix fetches a catalog). The component cannot derive one and does not try.
  - Having no thumbnail is the COMMON case, not an edge case — two of the three known consumers have none — so both variants must look deliberate without one. `variant="card"` renders a frame that keeps its `aspect-ratio: 1 / 1` and says "No preview"; it does not collapse to a text sliver. `variant="row"` omits the 36px tile entirely rather than stamping an empty grey square on every line of a list.
  - The frame is the SAME element in both states, so a mixed grid does not render ragged rows.
  - 🔴 A supplied URL that **fails to load** reaches the same placeholder, via `onError`. Keying only on the URL being _absent_ produced exactly the empty grey box the placeholder exists to prevent whenever a CDN 404'd, a host was ad-blocked or the viewer was offline — and with `alt=""` + `aria-hidden` there was nothing for assistive tech either. The failure is tracked _by URL_, so supplying a different thumbnail retries rather than latching the card into the placeholder forever.
  - The image is `loading="lazy"`. That is load-bearing rather than hygiene for the `card` variant, which exists for grids of dozens.

  **What is deliberately NOT a prop.** This is the half that makes promoting the component worth anything — the markup was never the expensive part. Each frozen item is a statement about what a resource _is_, and three apps disagreeing about it is three apps telling a viewer different things about the same model:

  - **The name fallback.** `modelName` is typed `string` (required) and the type is optimistic — model-benchmarking writes `modelName ?? '#'+versionId` in its own source, i.e. a first-party block has already seen it absent at runtime. A card rendering an empty string is indistinguishable from a broken card. The fallback is `#<versionId>`: still wrong-looking, but wrong in a way that identifies the resource. It is not overridable because a per-app placeholder ("Untitled model") is indistinguishable from a resource actually called that. Whitespace-only counts as absent. Exported as `resourceDisplayName` so a caller composing its own label agrees with the card rather than re-deriving it.
  - **The LoRA/Checkpoint distinction.** A frozen, case-insensitive map (`checkpoint` → "Checkpoint"; `lora`/`locon`/`lycoris`/`dora` → "LoRA"), rendered as a text label rather than by colour — colour alone is not an accessible distinction. 🔴 An UNRECOGNISED `modelType` renders VERBATIM and is never coerced into a known label: a Controlnet announced as "Checkpoint" is a confident lie about what the viewer is generating with, where the raw string is merely unpolished. A blank type renders no pill at all.
  - **The missing-thumbnail copy** ("No preview"). An empty grey box reads as an image that failed to load; "Loading…" would be a lie.
  - **The non-colour selected mark** (a `✓` glyph beside the name, `aria-hidden` because `aria-pressed` already announces the state). Selection used to be a 1px border-hue swap and nothing else — WCAG 1.4.1, and a direct contradiction of the type-pill rule two paragraphs up. The border-colour change stays as reinforcement, not as the only signal.
  - **The accessible-name composition** for an interactive card: `"<name>, <version>, <type>, <baseModel>"`, absent segments dropped. The visible tile read as raw content is `"Detail TweakerLoRARev2SDXL 1.0"` (and `"✓Detail Tweaker…"` once selected), so the button carries an explicit label — and because it LEADS with the visible name it satisfies WCAG 2.5.3 (Label in Name) rather than diverging from it. The selected state is not spelled into the name; `aria-pressed` already carries it.

  What legitimately varies is a prop: `variant`, `thumbnailUrl`, `selected`, `disabled`, the two content slots, `className`, `style`, `ref`, `data-testid`, and the surrounding grid or list.

  **Two content slots, and both render as SIBLINGS of the hit area.** That is the load-bearing detail: a `<button>` nested inside the card's `<button>` is reparented by the browser, so the inner control becomes unreachable by keyboard and its click is eaten by the outer one — and content inside the hit button is also invisible to assistive tech, because the button carries an explicit `aria-label` that overrides its contents.

  - `actions` — the trailing FLOW slot: a weight slider, a Remove button, a "Change" link. Available on both variants. Put anything clickable here.
  - `overlay` — 🔴 **`card` variant only, and a type error on a `row`**, which has no thumbnail corner to hang a pill in. It is the decorative status badge over the thumbnail corner ("Added", "In your queue"), positioned from the root, and it carries `pointer-events: none` so it cannot swallow a click meant for the card. Because it is a sibling of the labelled button its text IS announced — so mark an "Added" pill `aria-hidden` if `selected` is already set, or `aria-pressed` says it twice.

  What the `overlay` slot buys you, stated accurately: it owns the corner OFFSETS (arithmetic over the hit area's padding, which move together), the `pointer-events` decision, and the sibling-of-the-button placement. The card's root is `position: relative`, so a hand-rolled corner badge in `actions` would now land where you put it — the slot exists to stop three non-obvious decisions being re-derived per app, not because the placement is impossible. The root's `position` is load-bearing for both.

  `className`, `style` and `ref` are forwarded to the root, matching the convention the README states for the rest of the pack.

  **Accessibility, decided rather than defaulted:**

  - Interactivity is an explicit **discriminant prop**, not something inferred from whether `onSelect` happens to be defined. `ResourceCardProps` is a union: `interactive: true` requires `onSelect` and permits `selected`/`disabled`; the static arm forbids all three. Inference gets both halves wrong in practice — an `onSelect` on something rendered static is a handler that silently never fires, and an interactive card without one is a tab stop that does nothing. Under the union each is a type error. 🔴 Pass a **literal** or branch: `interactive={someBoolean}` narrows to neither arm and fails with TypeScript's opaque "not assignable to `IntrinsicAttributes & ResourceCardProps`". That is correct — a `boolean` cannot carry a sound "then `onSelect` is required" — and spreading an `as const` bag compiles.
  - 🔴 Do **not** wire `disabled` to the same expression as `selected`. A disabled button leaves the tab order and can never show a focus ring, so a keyboard user tabbing a 24-card grid silently skips everything they have already picked — and `aria-pressed` is precisely the affordance that makes re-pressing a selected card meaningful. Reserve `disabled` for genuinely unavailable resources.
  - Interactive → exactly one `<button type="button">` with `aria-pressed` and the composed label. Static → a plain `<div>` with no role, no `tabIndex` and no handler: a list of already-chosen resources must not put N dead focus stops between a keyboard user and the control they actually want.
  - 🔴 **NOT a link,** though it has `modelId`/`versionId` and could build a civitai.com URL. A block renders in a sandboxed iframe where a top-level navigation is host-mediated (`useCivitaiNavigate`), so an `<a href>` here would either be inert or punch the viewer out of the app mid-task. A card that navigates is a different component.
  - The `actions` slot renders as a SIBLING of the hit area, never inside it. A `<button>` nested in a `<button>` is invalid HTML: the browser reparents it, the inner control becomes unreachable by keyboard, and its click is eaten by the outer one. That is why the slot exists at all rather than callers wrapping their own controls around the card.
  - The thumbnail is decorative (`alt=""` + `aria-hidden`), so the resource is read once, not twice.

  `variant` is REQUIRED. There is no defensible default: the two exist because the known consumers split between them, and silently picking one renders the wrong shape for half the callers with no diagnostic.

  **Styling** follows the pack: attribute-driven CSS on `--civitai-*` tokens, added to this package's local stylesheet (`@civitai/components` has no counterpart for it), with the `Badge` primitive reused for the type pill. Every selector is double-qualified with `[data-civitai-ui='resource-card']` because `data-variant` is also emitted by Button and Badge.

  **Not covered:** the component does not surface `trainedWords`, `strength`/`minStrength`/`maxStrength` or `clipSkip`. Model-benchmarking's weight slider reads those and passes the control in via `actions`, which works, but a block that wants a _built-in_ weight control would have to reach past this component — worth deciding before wide adoption.

## 0.46.0

### Minor Changes

- b733a3b: Add `ReportButton` to `/ui` — a shared, two-step control that files a shared-board row for platform moderator review via `useSharedStorage().report()`.

  Three first-party blocks reached for this control independently (app-requests inline, model-benchmarking as a local component, custom-generators now needing a third), and each time the risk was the same one: wording that lets a viewer believe they deleted something. `report()` files a row and explicitly does **not** hide it — a moderator decides — and an app owner has no server-side hide to offer instead, because `update` and `withdraw` are author-scoped.

  So the three visible strings — the confirm question, the failure line and the settled line — are **not props**, and each is pinned whole by a test. Only `noun` varies.

  🔴 **What that guarantee is, precisely:** the wording _this component renders_ cannot drift across blocks by accident. It does **not** constrain what `onReport` does — a consumer can wire a real delete behind it and the control will still settle to "Reported for review" — and it cannot stop a host page restyling the settled text out of view. "Cannot drift by accident" is the claim; "unforgeable" would be wrong.

  Behaviour:

  - Nothing is filed from the trigger — only from an armed confirm, and the confirm is inert while that attempt is in flight. Cancel stays live throughout: `onReport` is a postMessage round-trip with no timeout, so disabling it would let a reply that never arrives wedge the control permanently. Each attempt carries an id instead, so a settle belonging to a cancelled or superseded attempt is discarded — it cannot mark the control reported, and it cannot clear the in-flight state out from under a newer attempt. That matters because `report()` is not documented idempotent the way `vote`/`unvote` are.
  - A rejected report keeps the control armed with "Could not send — try again?" rather than settling, and that line carries `role="alert"` — success is announced by a focus move, so without it a rejection is silent to exactly the users the fixed wording protects.
  - Focus moves with the control at both transitions. Each step replaces the element the viewer just activated, so otherwise a keyboard user is dropped to `<body>` mid-handshake.
  - `reported` lets your app drive the settled state. 🔴 The shared store cannot supply it — `SharedListItem` has `viewerVoted` and no report equivalent — so the only source is your own per-viewer record, written when `onReport` resolves. Without it the settled state is local-only, so any remount resets the control and the same viewer can file again.
  - The four secondary test hooks are derived from `data-testid` by suffix, so two rows in one list stay distinguishable once armed or settled.

  The caller decides who sees it: render only for a signed-in viewer who does not own the row, since `report` rejects anonymous viewers and an author has a real Remove.

  🔴 One consequence worth stating, since it is a deliberate trade rather than an oversight: a parent that sets `reported` and then withdraws it while a request is still outstanding leaves the control usable again, so that viewer can file the same row a second time. The alternative — keeping the superseded attempt's in-flight state — wedges Confirm permanently, which is worse, and it is the same trade the Cancel path makes. Supply `reported` from a durable per-viewer record rather than toggling it, and this does not arise.

  Not covered: there is no way to supply `report()`'s optional `reason` — a block needing one would have to abandon the component, so that is worth deciding before wide adoption.

## 0.45.1

### Patch Changes

- Updated dependencies [ee25ac9]
  - @civitai/components@0.4.1
  - @civitai/theme@0.3.1

## 0.45.0

### Minor Changes

- 73412e3: Ship civitai's responsive breakpoint scale as tokens, and the "am I narrow?" question as a hook.

  Until now a block author had no branch point at all: the pervasive inline-style idiom in blocks has no way to ask about its own width without hand-rolling a `ResizeObserver` and hard-coding numbers. Both halves of that are now provided.

  **`@civitai/theme` — the scale as tokens.**

  - New `--civitai-bp-xs` … `--civitai-bp-xl` CSS custom properties, plus `bpXs`…`bpXl` in the generated `tokens` / `tokenVars` maps and a `bp` group in the DTCG export.
  - New exports `breakpoints` (numbers — the form a JS width comparison actually needs, since a custom property cannot appear in a `@media`/`@container` condition), `BREAKPOINT_KEYS`, `civitaiBreakpointsSource` and the `BreakpointKey` type.

  🔴 **The values are civitai's PX scale, not Mantine's em scale, and the two agree on exactly one key.** `src/utils/breakpoints.json` (mirrored by civitai's Tailwind config and `mantineContainerSizes`) is `xs 480 · sm 768 · md 1024 · lg 1184 · xl 1440`; Mantine's stock em scale — which civitai never overrides and which every Mantine responsive prop uses — is `576 · 768 · 992 · 1200 · 1408`. Only `sm` matches, so a wrong implementation looks right at a glance and a test that pins `sm` alone passes against the wrong scale.

  Because of that, the scale is vendored in its own module (`src/breakpoints.source.ts`) with its own drift guard against `breakpoints.json`, and is emitted through the generator as a **literal** token spec that never touches the Mantine theme pipeline — routing it through `mergeMantineTheme` is precisely how an un-overridden key would silently resolve to the em value. `theme.source.ts` was not the right home: it is a byte-faithful copy of civitai's `createTheme({...})` override, and that override defines no `breakpoints` key at all.

  **`@civitai/blocks-react` — the question as a hook.**

  New `useBlockBreakpoint(ref?)`, plus the pure `resolveBlockTier(width)` and the `BlockBreakpoint` / `BlockSizeTier` types.

  ```tsx
  const bp = useBlockBreakpoint();
  <div
    style={{
      display: "flex",
      flexDirection: bp.below("sm") ? "column" : "row",
    }}
  >
    {bp.atLeast("md") && <aside>…</aside>}
  </div>;
  ```

  - **A container query, not a viewport media query.** It observes an element — by default `document.documentElement`, which inside the block's sandbox iframe _is_ the slot the host handed us. Slot width is not monotonic in viewport width (the `model.sidebar_top` slot is ~360px at a 360px viewport and only ~430px at a 1440px one), so `matchMedia` inside the frame answers a question nobody asked. Same reasoning as the host-side `chromeGeometry.ts`.
  - **Returns a tier, not a width.** `tier` is `'base' | 'xs' | … | 'xl'` with Tailwind semantics (a tier applies at its breakpoint and above); `atLeast(key)` / `below(key)` are the call-site-shaped comparators. A `ResizeObserver` fires on every pixel, so the hook stores the resolved _tier_ and returns a referentially stable object while the tier is unchanged — dragging 200px inside one tier re-renders the block zero times. Exposing the raw width would either force a render per pixel or be a lie, so it is deliberately not returned.
  - `measured` distinguishes "not measured yet" from a genuinely narrow block, since an unmeasured width resolves to `'base'`. SSR-safe: with no `ResizeObserver` the hook never touches the DOM.

- 393d9a1: Responsive base layer: `group` wraps by default, and `BlockGate` always injects the design-system styles.

  ⚠️ **Upgrading — one visible layout change.** A `group` row now **wraps** instead of overflowing, and its children may shrink. If you relied on a group staying on one line — a deliberately horizontal-scrolling toolbar, for example — add `data-nowrap="true"` to restore the previous behaviour:

  ```html
  <div data-civitai-ui="group" data-nowrap="true">…</div>
  ```

  This affects bare markup and `@civitai/components-react`'s `<Group>`. `@civitai/blocks-react`'s `<Group>` is unchanged — it already wrapped.

  **`@civitai/components` — `[data-civitai-ui='group']` now sets `flex-wrap: wrap` and lets children shrink (`min-width: 0`), with `data-nowrap="true"` to opt out.**

  There are **three** `group` surfaces, and they did not agree:

  - `@civitai/blocks-react`'s `<Group>` defaults `wrap = true` and writes `flex-wrap` as an _inline_ style — its consumers have always wrapped;
  - `@civitai/components-react`'s `<Group>` writes no inline style at all and has no `wrap` prop, so it resolved against the CSS;
  - bare `data-civitai-ui="group"` markup — the framework-agnostic contract this package exists to serve — likewise.

  The CSS carried no `flex-wrap`, so the latter two did not wrap. Nothing could see it, because each surface was only ever tested against itself. Measured in headless Chromium: three 140px controls in a 320px slot produced **436px of content in a 320px box**. They now reflow onto two rows and fit, and a test pins the CSS default against the rendered React default so they cannot drift apart again.

  **Be precise about what this is:** for `blocks-react` it aligns the CSS to a default that was already shipping, but for `@civitai/components-react` and for bare markup it is a genuinely **new default**.

  `min-width: 0` lets one long unbroken label narrow instead of pushing the whole row past its container. It applies to a child with the default `overflow: visible`; per CSS Flexbox §4.5 a child with any other `overflow` already has an automatic minimum size of 0.

  **`@civitai/blocks-react` — `BlockGate` now calls `useBlocksStyles()` on both branches.**

  Styling used to arrive as a side effect of rendering a `/ui` component, since each one injects for itself. A block that wraps its root in `BlockGate` but renders none of them — its own markup, another UI library, a canvas — got the stylesheets on the direct-load fallback and **zero design-system CSS on the happy path**. Wrapping the root is the one thing every block is told to do, so that is where it belongs.

  ***

  **Bump level: `minor`, decided — not an open question.**

  An adversarial audit recommended `major` for `@civitai/components`, on the grounds that `RELEASING.md` reserves it for "a behavior change that existing callers will notice" and this change is justified precisely by the fact that they do notice (436px of overflow becomes two rows). That reading is sound; it was considered and **the maintainer chose `minor`**, since publishing `@civitai/components@1.0.0` off `0.3.1` is a product decision rather than a correctness one.

  Recorded so a later reader knows this was weighed rather than missed, and so the trade-off is visible: shipping as `minor` means **this changelog entry is the only warning consumers get**, which is why the upgrade note is at the top rather than buried here. The concrete case it exists for is a published App Block rendering bare `data-civitai-ui="group"` as a deliberately horizontal-scrolling toolbar — that starts wrapping, and `data-nowrap="true"` is the one-attribute fix.

### Patch Changes

- Updated dependencies [73412e3]
- Updated dependencies [393d9a1]
  - @civitai/theme@0.3.0
  - @civitai/components@0.4.0

## 0.44.2

### Patch Changes

- 5017cdf: Fall back to readable copy when a host reply carries an EMPTY `error` string.

  Nine reply-error sites across eight hooks built their exception as
  `new Error(result.error ?? '<fallback>')`. `??` replaces only `null`/`undefined`,
  so it PRESERVES `''` — a host reply carrying `error: ''` produced an exception
  with no message at all, which is the hardest possible failure to debug from a
  block. `||` falls through to the fallback copy.

  `error: ''` genuinely reaches these hooks: each reply's validator in
  `internal/validate.ts` gates `error` on SHAPE only (`typeof p.error !== 'string'`
  → reject), so `''` is a VALID reply, and the hooks' `result.error || !result.result`
  guard still enters the error branch via its second disjunct. Verified empirically —
  all nine new regression tests fail at base with `expected '' to be '<fallback>'`.

  Sites: `useViewer`, `useBuzzBalance`, `useBuzzAccounts`, `useBuzzTransactions`,
  `useDailyCompensation`, `useAppWorkflows` (fetch + `cancel`), `useGatedImages`,
  `usePublishGenerationOutputs`.

  `useWildcardPack` is deliberately EXCLUDED and keeps its `??`:
  `isValidWildcardPackResult` constrains `error` to the closed
  `WILDCARD_PACK_ERROR_CODES` set, so `error: ''` is rejected upstream and the
  fallback is unreachable. A comment now records that so a future sweep does not
  "fix" it.

  `patch`: no exported type, signature or subpath changes — the only observable
  delta is the text of an exception that is empty today, and no caller can
  meaningfully branch on `''`.

## 0.44.1

### Patch Changes

- e7278a0: fix(blocks-react): treat a PRESENT `error` as the reject signal at the eleven remaining `{ok, error}` hook sites, and single-source the predicate

  PR #273 fixed six sites; eleven kept testing `error` for TRUTHINESS, so the two
  spellings sat side by side in one file for a release. `error: ''` is falsy but
  PRESENT — the reply validator early-accepts it and therefore SKIPS the
  success-field checks, so a truthiness test sails past into a field the validator
  never verified.

  The wire types hide this from `tsc`: `SHARED_LIST_RESULT.items` is typed
  REQUIRED while `error` is optional, so `result.items.map(...)` compiles and then
  throws at runtime.

  ## Sites

  `useSharedStorage`: `list`, `get`, `getCount`, `getCounts`, `append`, `vote`,
  `unvote`, `withdraw`. `useAppStorage`: `get`, `list`, `getQuota`.

  What each did at the base commit on `{ requestId, error: '' }`:

  | outcome                                                | sites                                                           |
  | ------------------------------------------------------ | --------------------------------------------------------------- |
  | threw a raw `TypeError` (deref of a missing field)     | `list` (both hooks)                                             |
  | resolved `undefined` typed `number`/`string`           | `getCount`, `getCounts`, `append`, `vote`, `unvote`, `getQuota` |
  | resolved `null` — indistinguishable from "no such key" | `get` (both hooks)                                              |

  ## Reachability — this is PROPHYLACTIC, not a live bug fix

  No currently-shipping host can trigger any of the above. Two earlier drafts of
  this note got the _mechanism_ wrong while reaching the right conclusion, so here
  it is enumerated rather than characterised. Error strings on these reply types
  come from at least **five** distinct sources across the two hosts:

  1. `storageErrorMessage()` — guards `message.length > 0`, else the constant
     `'storage request failed'`;
  2. `REVIEW_NACK_MESSAGE` — a non-empty constant, reaching **eleven of the
     seventeen** reply types (seven of the eleven this PR fixes), bypassing
     `storageErrorMessage()` entirely;
  3. the bare `err instanceof Error ? err.message : 'unknown'` path — the one
     source that CAN yield `''`, see below;
  4. bare non-empty literals on `SAVE_IMAGE_RESULT` (`'busy'`,
     `'image is not available'`, …);
  5. bare non-empty literals on `USER_CHECKPOINT_SET`.

  Every source but (3) is non-empty by construction, so the conclusion holds for
  the eleven sites this PR fixes. **Do not read the list as closed** — it is what
  an enumeration at `civitai@94a564a` found, and the honest claim is "these five,
  checked", not "these are all there can be".

  🔴 **One reply type in the seventeen IS fed by source (3).**
  `IframeHost.tsx` emits `USER_CHECKPOINT_SET` with
  `err instanceof Error ? err.message : 'unknown'`, and `err.message` is `''` for
  `new Error()`. That site is safe only because PR #273 already moved
  `useCheckpointPicker.persist` to presence — i.e. the guard is load-bearing
  there today, not prophylactic.

  (Separately, and untouched here: the other non-storage reply types use
  `error ?? fallback`. `??` does not replace `''`, so they can raise an Error with
  an EMPTY message. They still reject, via a `|| !result.<field>` clause.)

  ## Single-sourcing

  The predicate moved to `internal/replyError.ts` (`throwOnReplyError`,
  `throwOnFailedReply`) and all sites now call it, including the six #273 already
  fixed. A predicate open-coded at N sites is typically wrong at N-1 of them in the
  same direction; this is what makes a future divergence one edit instead of
  seventeen. The helpers are internal — no export surface changes, hence `patch`.

  ## One guard lost its reachability, and is now labelled instead of faked

  `withdraw()`'s `typeof result.deleted !== 'boolean'` narrowing was previously
  reached by a test sending `{ ok: true, error: '', deleted: 'yes' }` — but ONLY
  because the site tested truthiness. With presence, that fixture rejects on
  `error` first. The only other route is a non-boolean `deleted` with NO error,
  and `isValidSharedWithdrawResult` DROPS that before the hook sees it (measured:
  written as a reject assertion, it timed out at 5 s because the reply never
  settles). The test now asserts the DROP, and the narrowing is documented as
  defence-in-depth with no transport-reachable killing test — rather than keeping
  an assertion that can no longer execute.

## 0.44.0

### Minor Changes

- 591c1ab: fix(blocks-react): an ERRORED submit must reject, not resolve a reply it cannot report a workflow for (civitai/civitai-app-starters#251)

  The `submit` half of civitai/civitai#4159. PR #250 fixed `estimate`; this closes
  the same information loss on `submit`.

  ## Root cause

  `useBuzzWorkflow().submit()` resolved **every** failure-shaped reply. Two
  different things produce one and they are **indistinguishable by `status`** —
  both report `'failed'`:

  | producer                                               | what it means                                                                                     | carries `cost`?                                   |
  | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
  | budget / spend-cap rejection                           | a legitimate **outcome** the block recovers from (open a top-up flow)                             | **yes** — the price the server declined to charge |
  | a reply the host built itself (`failureSnapshot(err)`) | the host had **no workflow to report** — usually nothing was queued, but see the money note below | **no**                                            |

  So a block branching on `snap.status === 'failed'` could not tell "you can't
  afford this" from "the request failed", and one gating a money control on
  `typeof snap.cost?.total === 'number'` saw the same dead-control shape #250
  fixed for `estimate`.

  ## The discriminator

  `cost` presence, and it was already on the wire — no new field. The asymmetry is
  not incidental: **all 13** `status: 'failed'` sites on the server's submit path
  attach a price. Twelve are budget/cap exits (the per-call `buzzBudget` gate, the
  per-user daily Buzz cap, the per-app aggregate and velocity caps, the dev-tunnel
  session cap — across all three body kinds); the thirteenth is the
  **missing-price-quote** exit, which is not a cap at all but is priced just the
  same. `failureSnapshot(err)` never carries a price.

  🔴 **Not every priced refusal is affordability.** The per-app velocity limit, the
  per-app aggregate daily cap, a fail-closed "temporarily unavailable" deny and a
  missing price quote are priced, resolving outcomes that buying Buzz cannot fix.
  Docs and examples branch before offering a top-up.

  ## The change

  `submit()` rejects with the newly exported `WorkflowSubmitError` when the reply
  is failure-shaped **and** carries no numeric `cost.total`. `err.code`
  (`'exception'`) is the structural discriminator and `err.snapshot` is the host's
  raw reply, so nothing reachable before is lost.

  **Both clauses of the guard are load-bearing**, and each has its own control in
  the test file:

  - dropping `status === 'failed'` would reject every ordinary in-flight reply —
    `{ workflowId:'wf_…', status:'pending' }` is cost-less too;
  - dropping the cost test would reject the budget rejection and **break the
    top-up recovery flow**, which is the one thing #251 says must not break. The
    scope-pin test #250 left behind (`submit() still RESOLVES a budget rejection`)
    survives this change **unaltered** and is that clause's killing test.

  The cost test is `typeof … !== 'number'`, never `!snapshot.cost?.total`: `0` is a
  real price and falsy.

  `result` is published **before** the rejection, so a failed submit can never
  leave a previous submit's workflow sitting in `result`.

  **Where the reason lives: `err.snapshot.error`.** `err.message` is deliberately a
  generic developer-facing constant naming only the code — the lesson from #253,
  where two real apps piped `WorkflowEstimateError.message` straight into rendered
  UI. Raw upstream text (Prisma/`pg` constraint names among it) can reach
  `snapshot.error`, and `message` is what an uncaught rejection prints and what a
  third-party block's error reporter ships upstream by default. A regression test
  built from a realistic `Unique constraint failed: Key (email)=(…)` fixture
  asserts the raw string is preserved verbatim on `.snapshot.error` and absent from
  `message` fragment by fragment.

  ## Two codes, because they differ on whether MONEY MOVED

  `err.code` is the branch target and it is **not** a formality:

  - `'exception'` — the host built the reply itself (`failureSnapshot(err)`, which
    hardcodes `workflowId: 'failed'`), from a `catch` **or** a non-catch
    short-circuit such as the moderator-review nack. It means **the host had no
    workflow to report — not that nothing happened**. Usually nothing was queued or
    charged and a retry is fine, but a **lost response** (the server's own catch
    concedes a retry "DID create a workflow server-side despite a lost response"),
    an **in-progress idempotency CONFLICT**, or a **transient 5xx/408/429/401** on
    `dev:live` all land here. Retry with the SAME `idempotencyKey`, and never
    render "nothing was charged" as a certainty.
  - `'workflow-failed'` — an id that was NOT that sentinel came back failed and
    unpriced (normally a real orchestrator id; the `'whatif'` sentinel lands here
    too, and has nothing to poll)
    (`snapshotFromWorkflow` omits `cost` on any non-numeric total). 🔴 **Buzz may
    already be committed**: server-side, _any_ resolved submit keeps its
    reservation "regardless of snapshot status", with no refund on a non-throwing
    failed snapshot, and `finalizeGenIdempotency` runs on that path. So this arm
    must not tell the viewer it was free, and must not auto-retry — `submit()`
    mints a fresh `idempotencyKey` per call, so a blind retry is a SECOND
    reservation. Read `err.snapshot.workflowId` and poll it — after checking it is
    not `'whatif'`, which the server also treats as a non-workflow sentinel (it
    emits `workflow.id ?? 'whatif'` and skips persistence/settle on either).

  Classification is **fail-safe in ONE direction only**, and an earlier draft
  overstated it: an id that is not the host's `'failed'` sentinel falls to
  `'workflow-failed'`, so an unrecognised shape never buys the reassuring reading.
  The converse does not hold — the sentinel arm is itself reachable by cases where
  money may have moved, which is why its copy is now hedged rather than absolute.

  The sentinel is matched with `===` — exact and case-sensitive. Every looser
  comparison reclassifies a reply the host did not synthesise into the reassuring
  arm, and each direction needs its own near-miss fixture: `.startsWith()` accepts
  `failed-x`, `.endsWith()` accepts `x-failed`, a case-folding compare accepts
  `FAILED`. All are WIDENINGS, and a mutation sweep that only DELETES clauses sees
  none of them — three distinct widenings were found in review this way, each after
  the previous fix, including one where the source comment said "never a prefix
  test" while the tests pinned only that single direction.

  `err.message` is one template for both codes and deliberately makes **no claim
  about money** — an earlier draft read "submit did not queue a workflow", which is
  false for the second arm.

  ## Behaviour changes to know before upgrading

  - **Moderator review preview now rejects on submit**, as it already does on
    estimate: the host answers every workflow request there with
    `failureSnapshot('not available in review preview')`. A block without a `catch`
    turns a reviewer's first click into an unhandled rejection.
  - **Mock-host submit knobs that simulate a THROWN server error now reject** —
    `generation.failNext`, `generation.failRate`, `failMode: 'some'`, and
    `disallowedAccountTypes`. They emit the host's `failureSnapshot(err)` shape
    (the `'failed'` sentinel id, no `cost`), so they reject with
    `code: 'exception'`. The reason is unchanged and still fully recoverable, on
    `err.snapshot.error`.
    (`failMode: 'all'` / `'insufficient'` are the _priced_ arm and still RESOLVE.)
    🔴 **Correction to an earlier draft of these notes**: the claim that "the real
    backend has no generic submit-time failure outcome" was **wrong**. It does have
    generic transient failures — a fail-closed `unavailable` deny and a
    missing-price-quote exit — but it returns them as **priced, resolving**
    snapshots. That is a shape the mock does not yet simulate; the knobs above
    model a thrown error, which is a different thing.
  - **Mock-host failure snapshots now carry the real `workflowId: 'failed'`
    sentinel** instead of a synthetic `wf_fail_N`. Required for correctness, not
    tidiness: a made-up id classifies as `'workflow-failed'`, i.e. as a workflow
    that probably exists, with possibly-committed spend.
  - **Balance / `insufficient` mock paths still RESOLVE** — they model a priced
    refusal, and they now carry the `cost` the real server sends (see the fixture
    fix below).

  ## Also in this change

  - **New mock-host knob `generation.failSubmitException` (+
    `failSubmitExceptionMessage`)** — the estimate-side `failEstimate`'s twin.
    Until now an _errored_ submit was unreachable in every local harness: the
    balance / `insufficient` knobs model a budget rejection, which resolves, so a
    block author testing "what if submit goes wrong" only ever exercised the arm
    that never throws. That gap is a large part of how this stayed invisible. The
    knob is covered end-to-end through the real hook + transport, with a negative
    control asserting submits behave normally when it is unset.
  - **Fixture fidelity fix — the mock host's insufficient-Buzz snapshot was missing
    its `cost`.** The real server quotes the price at every budget/cap exit; the
    mock did not. Left alone, the fix would have made the mock's own top-up path
    reject, i.e. the local harness that exists to exercise the recovery flow could
    no longer reach it.
  - **Pre-existing defect fixed in the `buzz-purchase` example harness**: its
    insufficient-budget reply used `workflowId: ''`, which the SDK's inbound
    validator DROPS — so the reply never resolved the pending request and the
    demo's insufficient path hung to the transport's 120s timeout rather than
    showing the top-up CTA. It now uses the real `'failed'` sentinel and carries a
    `cost`, matching the server.

  ## What this does NOT change

  The budget-rejection arm. It resolves, exactly as before, and the recovery flow
  blocks depend on is untouched.

  ## Correction to an earlier draft

  An earlier draft of these notes said a real failed workflow was indistinguishable
  from a `failureSnapshot(err)` and called it an accepted residual. **That was
  wrong.** The wire does separate them: every host-synthesised failure goes through
  `failureSnapshot()`, which hardcodes `workflowId: 'failed'`, while
  `snapshotFromWorkflow` returns the real `workflow.id`. That is what
  `'workflow-failed'` is keyed on, and it is why the money language can now be
  correct per code instead of uniformly optimistic.

### Patch Changes

- 5871331: fix(blocks-react): treat a PRESENT `error` (not a truthy one) as the reject signal in the six hooks whose reply validators early-accept on `error` — `error: ''` is falsy, so it skipped the success-field checks and resolved with unvalidated garbage
- 5871331: fix(blocks-react): normalize the `{ok, error}` reply validators so an error reply is always valid — six of them dropped `{requestId, error}` and hung the block to its request timeout

## 0.43.1

### Patch Changes

- 5d9a37a: Document `WorkflowEstimateError.message` as DEVELOPER-facing, so a migrating app
  stops piping it into rendered UI.

  `0.43.0` moved the server's raw text off `message` and onto `.snapshot.error`,
  leaving `message` a generic constant
  (`estimate did not return a usable price (failed) — reason on .snapshot.error`).
  That was deliberate — `message` is what an uncaught rejection prints and what a
  third-party error reporter ships upstream, so raw upstream text (Prisma/`pg`
  constraint names among it) must not live there.

  But the guidance said **"print `err.message`"**, which reads as viewer-facing.
  Two apps migrated to `0.43.0` on the same day and **both** had a `try/catch`
  piping `err.message` straight into rendered UI; both would have shipped that
  sentence to end users, and each was caught only by a test asserting the exact
  string. Nothing in the docs told them not to.

  No behaviour change — this is documentation only, but the class JSDoc ships in
  `dist/hooks/useBuzzWorkflow.d.ts` and is the IDE hover text every block author
  reads, so it is a change to the published contract surface.

  The three fields are now documented by AUDIENCE, and the point that none of them
  is viewer-facing copy is stated explicitly:

  - **`code`** (`'failed' | 'no-cost'`) — the **branch target**, and the only
    stable one. Switch on it to pick a viewer-facing string the APP owns.
  - **`snapshot.error`** — the **diagnostic** read. Server-authored and
    unsanitised; log it or show it in a developer-facing surface, never render it
    verbatim into markup.
  - **`message`** — **developer-facing**. Safe to log and to let a stack trace
    print; not intended for display to viewers (it names an internal field path
    and is not localised), and **its exact wording is not a contract**, so a UI
    built on it silently rots.

  The `@example` on `useBuzzWorkflow` and the README snippet now show the shape the
  two migrating apps both converged on independently — catch, branch on `code`,
  render an app-owned constant, log `message` + `snapshot.error`:

  ```ts
  const estimateFailureMessage = (err: WorkflowEstimateError) =>
    err.code === "no-cost"
      ? "We could not get a price for this configuration. Try adjusting it."
      : "Pricing is unavailable right now. Please try again shortly.";

  try {
    await estimate(body);
  } catch (err) {
    if (!(err instanceof WorkflowEstimateError)) throw err;
    logForDebugging(err.message, err.snapshot.error); // developer-facing: LOG only
    showError(estimateFailureMessage(err)); // viewer-facing: app-owned
  }
  ```

  The `0.43.0` CHANGELOG entry's "print `err.message`" bullet was amended in place
  rather than only corrected here, because that entry is what a consumer migrating
  to `0.43.0` opens — a correction filed one version later would never be read by
  the people the defect targets. The amendment is marked as a post-publish
  correction and changes wording only.

## 0.43.0

### Minor Changes

- 6cbb2d1: `useBuzzWorkflow().estimate()` now REJECTS when the host's reply carries no
  usable price, instead of resolving a snapshot with no `cost` (civitai/civitai#4159).
  Adds the exported `WorkflowEstimateError` and a `generation.failEstimate` mock-host
  knob.

  **`minor`, and deliberately so.** This is a behaviour change, not purely additive
  — but the package is pre-1.0, where this repo's practiced convention is that
  breaking changes ride a `minor` (see the `0.4x` line's earlier entries). It also
  genuinely _adds_ API (`WorkflowEstimateError`, `failEstimate`). Calling it
  `patch` would be wrong; calling it `major` would break that convention.

  ## Why

  A server-side `blocks.estimateWorkflow` error cannot reach the block as a
  rejection — the reply crosses `postMessage` — so the host posts a well-formed
  `ESTIMATE_RESULT` carrying `{ workflowId: 'failed', status: 'failed', error }`
  with no `cost`. `estimate()` used to resolve that and move the hook to
  `'confirming'`, so a block that correctly gates Confirm on
  `typeof snapshot.cost?.total === 'number'` rendered a confirm dialog it could
  never confirm ("Cost unavailable"), while the server's explanation — already
  present on `snapshot.error` — was discarded.

  There are **two** producers of that observable, and the guard covers both:

  - `code: 'failed'` — the estimate errored server-side.
  - `code: 'no-cost'` — an otherwise-successful snapshot whose `cost` the server
    omitted because the whatIf reply had no numeric total.

  The server's reason is on **`err.snapshot.error`** — that is the diagnostic read,
  and recovering it is the point of the fix. `err.message` is deliberately generic
  and names the code instead; it is developer-facing, not viewer-facing copy.

  A cost of `0` is a real price (a whatif cache hit prices at 0) and still
  resolves; only a non-numeric `cost.total` rejects.

  ## Migration

  Callers that already wrap `estimate()` in `try/catch` — the shape the hook's
  docs and every starter use — need no change. Others must add one:

  ```ts
  // Viewer-facing copy is a string YOUR APP owns, chosen by `code`.
  const estimateFailureMessage = (err: WorkflowEstimateError) =>
    err.code === "no-cost"
      ? "We could not get a price for this configuration. Try adjusting it."
      : "Pricing is unavailable right now. Please try again shortly.";

  try {
    await estimate(body);
  } catch (err) {
    if (!(err instanceof WorkflowEstimateError)) throw err;
    logForDebugging(err.message, err.snapshot.error); // developer-facing: LOG only
    showError(estimateFailureMessage(err)); // viewer-facing: app-owned
  }
  ```

  Three things to know:

  - **Moderator review preview now rejects too.** The host answers every workflow
    request there with `'not available in review preview'`, so a block without a
    `catch` turns a reviewer's first click into an unhandled rejection.
  - **The raw server string is on `err.snapshot.error`, never on `err.message`.**
    Exposure to the block is unchanged (`snapshot.error` was always on the wire),
    but `message` is what an uncaught rejection prints and what a third-party
    block's error reporter ships upstream — and raw upstream text (database
    constraint names among it) can reach **`snapshot.error`**. So `message` is a
    constant template carrying only the `code`, with no server text in it at all,
    while **`snapshot.error`** holds the server's words and is documented as
    server-authored and unsanitised.

    🔴 **Neither field is viewer-facing copy.** `err.message` is
    **developer-facing** — safe to log and to let a stack trace print, but it
    names an internal field path, it is not localised, and its exact wording is
    **not a contract**. `err.snapshot.error` is the **diagnostic** read and must
    never be rendered verbatim into markup. **`err.code` is the branch target**:
    switch on it to pick a viewer-facing string your app owns. _(Corrected
    after publish — this bullet originally read "print `err.message`", which two
    migrating apps reasonably took as viewer-facing and piped straight into
    rendered UI. The wording above is the only thing that changed; no behaviour
    did.)_

  - **`result` is updated before the rejection**, so a failed estimate can never
    leave a previous config's price in `result` for a Confirm gate to read.

  ## Not changed

  `submit()` still resolves failure-shaped snapshots. It has the same two
  producers (budget rejections, which carry a `cost` and are a documented outcome
  the block recovers from; and caught server exceptions via the same
  `failureSnapshot`, which do not) — so the defect is live there too, discriminated
  by `cost` presence rather than `status`. Fixing it is a separate change with its
  own blast radius on the top-up recovery path.

### Patch Changes

- 168de29: Fix `usePublishGenerationOutputs()` rejecting mid-consent-dialog, which billed the viewer for outputs that reached nothing.

  `PUBLISH_GENERATION_OUTPUTS` is consent-gated: the host opens its own "publish to
  the shared grid?" confirm and replies only on an explicit human click or dismiss.
  The hook passed no `timeoutMs`, so it inherited the transport's
  `DEFAULT_REQUEST_TIMEOUT_MS` of 30 seconds — the budget for a fast protocol
  round-trip, not for a person noticing a modal and reading it. Past 30s the bridge
  rejected with `IframeTransport: request "PUBLISH_GENERATION_OUTPUTS" timed out
after 30000ms` while the dialog was still on screen. The generation itself had
  already succeeded and been billed, and a dead publish bridge has no refund path,
  so the charge stood and the outputs were lost (civitai/civitai#4158, reproduced
  2 of 2 across different models, ecosystems and prices).

  `publish()` now passes the same 10-minute human-interaction bound the pickers and
  the image upload already used. It still does not hang: the host resolves the
  instant the viewer acts, and the ceiling still bounds an abandoned dialog.

  Two more changes ride along, both internal:

  - `useBuzzPurchase().openPurchaseModal()` had the identical defect — its reply
    arrives when the viewer closes a purchase modal, and on the 30s default it
    rejected mid-checkout, reading to the block as "purchase failed" for a purchase
    that may have succeeded.
  - `PICKER_REQUEST_TIMEOUT_MS` is renamed `HUMAN_INTERACTION_TIMEOUT_MS` and moved
    to `internal/requestTimeouts.ts`, alongside a TOTAL bucketing of every
    block→parent message type into `human` / `protocol` / `no-reply`. The old name
    described the first caller rather than the property that selects the timeout,
    which is how a consent confirm failed to read as "a picker" to the author who
    omitted it. **No public API changes** — the constant is not reachable by
    consumers: it was never re-exported from the package entry point, and the
    `exports` map declares no deep subpath, so a deep import fails at resolution
    with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## 0.42.0

### Minor Changes

- c30b30c: Deep-copy the host-side slot context, so the dev harnesses match the production
  `postMessage` boundary instead of aliasing the caller's nested values.

  `hostContextWithTheme` — the host-side helper that layers the resolved `theme`
  onto a slot context on its way into `BLOCK_INIT` — returned `{ ...ctx }`, a
  SHALLOW copy. That fenced off whole-key reassignment and nothing else.

  The divergence that made it matter: the function is imported by exactly two call
  sites, both DEV hosts (`createMockHost`, `createLiveHost`), and both deliver
  host→block messages with `win.dispatchEvent(new MessageEvent('message', …))` — a
  same-realm synthetic event that passes `data` **by reference**. There is no
  structured clone anywhere on that path. Production's real cross-origin
  `postMessage` does structured-clone, but production never calls this function. So
  every nested value on a dev-delivered context kept the harness's identity — for a
  `ModelSlotContext` that is `checkpoint` (an object) and `showcaseImages` (an
  array). A harness mutating `ctx.showcaseImages` IN PLACE after init still reached
  the block's `BlockSnapshot`, which a block is entitled to treat as immutable; and
  in the other direction anything downstream of the snapshot writing through its own
  context corrupted the harness's own fixture.

  It now returns `structuredClone(ctx)`. The rationale is **production parity, not
  defensiveness**: the clone is exactly what the real boundary does, so a block that
  behaves correctly in the harness behaves correctly in production — which is the
  entire point of a dev harness.

  🔴 **A non-cloneable `options.context` now THROWS, and that is fidelity, not a
  regression.** A function, class instance, proxy or DOM node makes
  `structuredClone` raise `DataCloneError`, and production's `postMessage` would
  reject the same input; a silent shallow fallback would re-open the divergence the
  clone exists to close. Because a raw `DataCloneError` from this depth names
  nothing useful, it is re-thrown as an error naming the function, the offending
  `slotId` and the likely cause, with the original `DataCloneError` preserved as
  `cause`.

  The theme-merge semantics are unchanged: still keyed on the slot id (not on
  `'theme' in ctx`), and still never invents a `theme` on an `UnknownSlotContext`.

## 0.41.0

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

### Patch Changes

- 747038d: Retire the last "customComfy is recipe-only" claims — an app CAN ship its own
  ComfyUI graph.

  `WorkflowBodyCustomComfy` became a real discriminated union on `mode` in #215
  (`@civitai/app-sdk` 0.32.0-to-be), so a block can carry the ComfyUI graph itself
  (`mode: 'inline'`) instead of naming a server-registered recipe. That fix landed
  on the TYPE and its doc comment. Three comments in `@civitai/blocks-react` went
  on describing `customComfy` as a recipe-only `{ kind, recipe, params }` shape:

  - `useBuzzWorkflow`'s JSDoc — the one a block author reads on hover — listed the
    `WorkflowBody` members as "a `customComfy` recipe body (`{ kind, recipe,
params }`)". It now names both arms and says plainly that an app can ship its
    own graph.
  - `createMockHost`'s docblock claimed the money path "drives BOTH `WorkflowBody`
    arms", naming two of three members and reducing `customComfy` to its recipe
    shape. It also asserted that "a customComfy body's preferred pool lives under
    `params.accountType`" — false for an inline body, which has no `accountType`
    at all, as `preferredAccountType` a thousand lines above already documents.
    The docblock contradicted the function.
  - The `ESTIMATE_WORKFLOW` handler comment repeated "both WorkflowBody arms —
    `textToImage` AND `customComfy` ({ recipe, params })". The adjacent
    `SUBMIT_WORKFLOW` comment is corrected in the same pass.

  Comments only — no runtime behaviour, no type, and no API changes. The reason it
  is worth a release rather than a silent doc tidy is what the false version cost:
  in a blind dogfood a developer working against the LIVE inline feature read the
  equivalent claim, believed it over their own instinct, and concluded the
  capability did not exist.

  Adds `test/customComfy-doc-currency.test.ts`, which pins the two specific
  regressions that happened — the recipe-only phrasings are absent, and each
  docblock names the inline arm _within that docblock_ rather than anywhere in the
  file (a whole-file check passes on an unrelated mention a thousand lines away,
  which is precisely how the stale block hid next to a correct one).

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
