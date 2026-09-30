# @civitai/sdk

## 0.9.0

### Minor Changes

- 51a978a: `SignIn.signInWithPopup()` signs the viewer in with Civitai in a popup, so a page that must not be navigated away from (an embedded chat, an editor) keeps its state. The popup returns to `redirectUri`, whose `createSignIn()` hands the result back over a same-origin `BroadcastChannel` and closes the popup. `SignInError` gains `code` (`'popup-blocked'`, `'canceled'`); an `AbortSignal` cancels. Additive: `signIn()` and the redirect flow are unchanged.

## 0.8.0

### Minor Changes

- 62bf04d: `AppClient.sharedStorage` — a generic cross-user key/value client over
  `/blocks/shared-storage/*`, mirroring the per-viewer `AppClient.storage`.

  Five methods: `list`, `get` (the `/item` route, matching its tRPC twin
  `apps.shared.get`), `append`, `update`, `withdraw`.

  **Minor, not patch or major.** Purely additive: one new property on `AppClient`
  and six new exported types. No existing signature, type or behaviour changes, and
  the regenerated `api/public-api.md` is an insertion with **zero deletions** —
  which is the mechanical form of that claim, not a restatement of the intent.

  ⚠ One honest caveat on "additive": `AppClient` is an _interface_, so code that
  **implements** it rather than consuming it — a hand-written test double, not a
  normal app — must now supply `sharedStorage` or stop compiling. Consumers that
  only call into it are unaffected.

  ## Deliberately five of eleven

  The platform serves eleven shared-storage routes. This client wraps the five that
  are key/value operations; **`vote`, `unvote`, `counts`, `top`, `increment` and
  `report` are intentionally absent.** Shared storage is scoped to generic
  key/value, and an app that needs voting, counters or reporting builds them at its
  own layer on top of these five. The platform surface can expand later if demand
  shows up. 🔴 The routes existing is not a reason to add a method — recorded in
  `BREAKING.md` so the omission does not read as an oversight.

  `SharedItem` still carries **`count` and `viewerVoted`** as the read routes
  project them: reading a tally is exactly what makes an app-layer vote feature
  possible, and only the vote-casting operation is out of scope.

  ## No app is unblocked by this yet — the port is what needs it

  An earlier draft of this changeset claimed the surface unblocked a shipping
  "Popular" rail in `civitai-app-playable-collections`. **That was false.** Measured
  in that repo's `package.json`: its Civitai dependencies are `@civitai/app-sdk`
  and `@civitai/blocks-react` — it does **not** depend on `@civitai/sdk` at all. It
  is blocked on being _ported_, and the port is what needs this surface to already
  exist. Nothing ships against it today.

  The seam test's mirrored `PopularRailStore` slice went with that claim: a mirror
  of a slice nobody declares reads as coverage while pinning nothing, and it froze a
  shape (`vote`) this client does not even carry. `test/shared-storage/seam.test.ts`
  now says so in place of the mirror, and records what to add when the first app is
  actually ported.

  ## What the port off the bridge actually costs

  `@civitai/blocks-react`'s `useSharedStorage` is what the fleet uses today, and it
  is **the bridge** — it sends `SHARED_*` messages over `postMessage` and never
  touches `/api/v1`; the host receives them and calls tRPC `apps.shared.*`, injecting
  the credentials. So it is the LEFT column of `BREAKING.md`'s master table, not a
  rival HTTP client of the right one.

  The transport changes from `postMessage` to HTTP, but **the credential and the
  CORS declaration are already handled by code that exists**: `createHttp` sends
  `Authorization: Bearer <token>` on every request and retries once on a `401`, the
  token still comes from the host over the bridge (`REQUEST_TOKEN` — the host keeps
  minting and rotating it), all five routes declare `allowOpaqueOrigin`, and scopes
  are identical on both transports. No token plumbing, no CORS work, no manifest
  change.

  The remaining work is at the call sites: narrow `value` from `unknown`, move
  vote/counter/report logic into the app layer, branch on `ApiError.status` where
  the bridge surfaced a message, and audit every `limit`.

  ⚠ `BREAKING.md` records that this section has had three framings and that two are
  retracted — _"a second client for these same routes"_ (false: different
  transports) and _"budget for the token/CORS work"_ (false: both already handled) —
  so the ground is not re-walked.

  Two divergences worth calling out among the five kept methods:

  - **`list({ limit })` is validated, not normalised — three changes, not one.** The
    bridge _host_ clamped out-of-range to 1…100, floored non-integers, and fell back
    to 50 for anything non-finite. The REST route's
    `z.coerce.number().int().min(1).max(100)` **`400`s on all three**. The sharp one:
    `Number(param)` on a missing value is `NaN`, which used to mean "give me the
    default" and is now a failed request. The `400` body is
    `{ error: 'Invalid query', details }`, so `ApiError.message` reads only "Invalid
    query" — the field-level reason is in `ApiError.body.details`. This client
    deliberately does not re-clamp: bounds stay the server's, and a guard here
    enforces that the module carries no numeric literal at all.
  - **A listed row's `value` is `unknown`**, versus the hook's typed
    `SharedAppendValue`. Deliberate and wire-honest: the row was written by another
    viewer's copy of the app, possibly an older version, so its shape is a fact
    about stored data rather than a promise a client can keep.

  ## Four ways this is NOT a copy of the per-viewer client

  Each would have been an invisible bug had the per-viewer shape been assumed, and
  each is pinned by a mutant watched to go red:

  - **The two reads are `GET` with a query string**, the three writes `POST`. The
    read routes answer `405` to a POST.
  - **`list` is enveloped**: `{ items, metadata: { nextCursor } }`, so the cursor
    arrives one level deeper than the per-viewer client's top-level `nextCursor`.
    Reading the wrong level yields a well-formed page with pagination silently
    dead — caught by a fixture pair differing only in the cursor's location.
  - **`append` accepts no key** — the server mints a ULID, so one viewer cannot
    overwrite another's row.
  - **An anonymous viewer MAY read and may never write.** This inverts the
    per-viewer rule, where every call is refused without a subject. Signed-out
    browsing is supported; an anon write is a `403` from the scope binding, and a
    _signed-in_ viewer below the server's minimum-trust gate is also refused.

  ## Guard philosophy, carried over verbatim

  Every failure rejects; no path resolves to mean "not written" or "could not
  read". A malformed 200 throws rather than manufacturing an empty store, because a
  caller renders an empty page to every viewer as "this store is empty".

  `list` guards **`metadata` symmetrically with `items`**, rather than defaulting it
  to `{}`. `metadata` is where `nextCursor` lives and the cursor's absence is what
  proves a scan completed, so a lenient default would turn a malformed envelope into
  `nextCursor: undefined` — stopping a caller's paging loop after page one and
  rendering 50 of 5,000 rows as the whole store, while the identical malformation of
  `items` threw. A well-formed empty envelope still resolves; that is the last page.

  Both
  timestamps are revived through a type gate _and_ a NaN gate, since
  `new Date(null)` is the epoch rather than an Invalid Date and would sort wrong
  forever without throwing.

  The module contains **no numeric literal at all** — every bound (key length,
  prefix, cursor, both list limits, the value byte cap) stays the server's, pinned
  by a scanner with its own positive control.

  ## Verification

  Re-measured after the surface cut; the earlier run covered methods that no longer
  exist.

  - `packages/civitai-sdk/vitest.config.ts` via `pnpm --filter @civitai/sdk test`:
    **19 files / 230 tests passed**, up from 17 / 187 at `origin/main` (203bcef),
    which was measured green first — so no failure here is attributed to a
    pre-existing red.
  - **Mutation battery over the five surviving methods: 23 mutants, 23 killed, 0
    survived**, each by a test naming that guard. Harness validated with both
    controls: an unmutated tree green, and a known-bad mutant observed red before
    any result was believed. Counted from the runner's own per-test result lines,
    not an exit code.
  - `pnpm --filter @civitai/sdk typecheck` and `check:layering` clean; `api:check`
    was **stale before regeneration**, which is the evidence that gate actually
    covers this package's surface.
  - The two storage fakes' byte-identical wire helpers (`utf8`, `toBase64`,
    `fromBase64`, `jsonResponse`, `SEED_EPOCH_MS`) are now one copy in
    `test/support/wire.ts`.

## 0.7.0

### Minor Changes

- bc154d1: New subpath `@civitai/sdk/safe-storage` — repair web storage at an opaque origin.

  A block is framed in a sandbox without `allow-same-origin` — civitai adds that
  token only for the `internal`/`verified` trust tiers, and in v1 every approved
  block is `unverified` — where merely _reading_ `localStorage` or
  `sessionStorage` throws a `SecurityError`. Any dependency that touches storage
  while its module body evaluates then takes the whole block down, and nothing
  outside that dependency can guard it.

  `@civitai/app-sdk/blocks` has installed a repair for this since it shipped. An
  app that has finished porting to `@civitai/sdk` imports neither that entry nor
  `@civitai/blocks-react`, so it had no repair available at all. This adds one,
  behind its own side-effect subpath:

  ```js
  import "@civitai/sdk/safe-storage"; // keep it FIRST in your entry module
  ```

  This is **opt-in, and the import must come first**. ES imports are hoisted, so a
  storage-touching dependency imported above it still evaluates first. Importing
  `@civitai/sdk` itself installs nothing: the package root stays pure re-exports,
  side-effect-free and fully tree-shakeable, so nothing changes for Node/SSR
  consumers.

  Two things to know before importing it from an app at a **real** origin, where
  storage works — neither can happen in the block sandbox it is built for:

  - Classifying a store is a real round trip, so import writes and immediately
    removes `__civitai_app_sdk_storage_probe__` on `localStorage` and
    `sessionStorage`. Contents are unchanged and neither store is replaced, but
    each write queues a `storage` event in other documents sharing the store — a
    cross-tab listener that does not filter by key will see spurious events.
  - A **full** store is indistinguishable from a disabled one through a write
    probe, so a `QuotaExceededError` counts as broken: the repair swaps in the
    in-memory fallback, seeded from everything it could still read. Nothing
    readable is lost, but persistence is — later writes are session-scoped.

  `package.json` declares `sideEffects: ["./dist/safe-storage/index.js"]` instead
  of `false`, because a bare `false` would let any bundler drop a side-effect-only
  import. `./dist/index.js` is deliberately not in that allowlist.

  Costs roughly 0.7 kB gzipped in a bundle that imports the subpath, and nothing
  in one that does not.

## 0.6.0

### Minor Changes

- c49ade1: `isTerminalStatus(status)` is exported alongside `isTerminal(workflow)`, for
  asking the same question about one step.

## 0.5.0

### Minor Changes

- 11fe746: A block-scoped token for a signed-in viewer no longer stops `initialize()`. The
  0.4.0 guard rejected it outright, and that was wrong for two reasons measured
  since:

  - **It rejected the DEFAULT host configuration.** The OAuth mint is behind
    `APP_BLOCK_OAUTH_TOKENS_ENABLED`, which defaults **false**, so a block that had
    declared `auth: "oauth"` correctly still received the block JWT — and then could
    not start at all, including on the `blocks/*` routes and `app.storage` that token
    is the _required_ credential for.
  - **It deadlocked the `consent_required` fallback.** That path exists so a block
    can ask for consent, and it is only reachable for a signed-in viewer, so the
    guard fired before the prompt could be shown. `app.requestGrants()` reaches the
    host's consent dialog on a block token; it just has to be handed to you first.

  The diagnostic is not gone — it moved to the surface that actually cannot serve
  the token, which is where the SDK can say something true:

  | Surface                                      | Holding a block token, signed in                                                                                                                                                                                               |
  | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `app.storage.*` and `app.site` on `blocks/…` | Work. Unchanged                                                                                                                                                                                                                |
  | the rest of `app.site` (`/api/v1`)           | The API's own 401/403, with the `auth: "oauth"` opt-in appended to the message. `ApiError`'s `status` and `body` are untouched, so a caller can still branch on them                                                           |
  | `app.orchestration.*`                        | Rejects **before** the request with a `CivitaiError` naming the opt-in. The orchestrator accepts no block token on any route, so this destination — unlike a path-addressed `/api/v1` route — is known without making the call |
  | `app.requestGrants(...)`                     | Works                                                                                                                                                                                                                          |

  Anonymous viewers and hosts that send no `kind` behave exactly as before: no
  OAuth token is minted for an anonymous viewer whatever the manifest says, so the
  manifest is not their fix, and an absent `kind` is not evidence of a block token.

  **No new API.** There is no opt-in flag to restore the eager refusal: the public
  declarations are byte-identical to 0.4.0's and only doc comments moved. A block
  whose first screen already needs an OAuth-only surface learns that from the first
  call to it, with the same `auth: "oauth"` advice it would have got at startup.

  ⚠ Two things the SDK does not claim to know, and the messages say so rather than
  guessing:

  - **Which `/api/v1` routes accept a block-scoped token.** That set lives in the
    server's repo and changes without a release here, so the message names
    `blocks/*` — the token's own mint namespace — and states that the rest is not
    known from the client. The advice stays conditional: _if_ this path needs an
    OAuth token, declare it. `GET /api/v1/models/{id}` is in fact accepted (the one
    dual-auth route today), so a refusal there carries the same conditional note;
    `BREAKING.md` has the route map as it stood at this release.
  - **Whether a route refused at all.** A _public_ `/api/v1` route such as `images`
    ignores an unusable token and answers **anonymously** rather than refusing, and
    nothing observable at the client seam separates that from a successful
    authenticated read. Prefer the `blocks/*` twin.

  **Minor, not patch, deliberately.** Nothing that worked stops working and no API
  is added, but whether `initialize()` throws is observable — that behaviour change
  is the whole release. Under 0.x a `^0.4.0` pin resolves `>=0.4.0 <0.5.0`, so a
  minor is the boundary that stops it reaching an existing pin silently. Bumping
  the range is the opt-in.

### Patch Changes

- 3898978: `BREAKING.md` and `README.md` corrections. Both ship in the tarball and are what
  a porting app reads, so several of their claims were sending people the wrong way.

  **Two things here are actions you should take, not just doc fixes:**

  - **Delete any `{ query: { id: context.modelId } }` workaround** you carry on
    block REST calls. Scope binding became per-route in civitai `3a1e090924`, so the
    unrelated-scope 403 that workaround existed for cannot happen. The old text told
    you to add it to _every_ block REST call.
  - **Change `app.site.get('me')` to `app.site.get('blocks/me')`.** The former
    resolves to `/api/v1/me`, an `AuthedEndpoint` that does not accept a block
    token, so it 401s.

  Also corrected:

  - **Anonymous shared-storage reads work on REST.** The same fix unblocked them; if
    you deferred a signed-out-browsing migration over that 403, it is unblocked.
  - **The `APP_STORAGE_*` routes exist and are POST-only** (`get`, `set`, `delete`,
    `list`, `quota`) — the row previously said "No v1 route", then briefly said
    `GET|POST`.
  - **Submit generations through `/api/v1/blocks/workflows/*`, not
    `app.orchestration`.** The raw orchestrator drops the Buzz budget, the caps, the
    maturity clamp and the attribution tag, and the substitution type-checks. The
    README quick-start now says so at the call site.
  - **The block token reaches more than `/api/v1/blocks/*`** — 35 routes, including
    `GET /api/v1/models/{id}`. 🔴 But note `/api/v1/images` is a _public_ endpoint:
    it ignores your token and answers with anonymous results rather than refusing,
    so use `/api/v1/blocks/images`.
  - **Error bodies are not uniformly `{ message }`.** Middleware rejections carry
    `{ error }` only; read `message ?? error` and branch on the status.
  - **The manifest `auth` field** is documented as built but flag-gated, with what a
    block can and cannot tell about which credential it was handed — `viewer === null`
    identifies an anonymous viewer outright, but flag-off and consent-outstanding are
    not separable from the client.
  - Scope binding, shared-storage counts and the anon-write status corrected
    throughout.

## 0.4.0

### Minor Changes

- 9c3eeed: A block's `initialize()` now refuses a block-scoped token for a signed-in
  viewer: `/api/v1`, the orchestrator and the MCP reject that token, so the SDK
  throws a `CivitaiError` up front pointing at the fix, `auth: "oauth"` in
  `block.manifest.json`. With that opt-in the host hands over a real OAuth access
  token, and consent goes through the host's dialog. `WrappedToken` and
  `BlockToken` gain `kind?: 'block' | 'oauth'`; a host that predates the field
  sends none, and the SDK then behaves as before.

## 0.3.0

### Minor Changes

- 81bd1b4: `host.openImageUpload` — civitai's own upload modal, and the moderation verdict
  that follows it. The frame never handles the bytes; the host takes the file
  through the viewer's session and hands back what it stored.

  Two modes, because the host has two:

  - **A public image** resolves a `PendingImage` — the image exists and its author
    can see it, and `scan()` answers whether anyone else may. The host reaches
    that verdict after the upload has already resolved and pushes it separately,
    so `scan()` is the only way to learn it.
  - **`{ purpose: 'generationSource' }`** resolves `{ url, width, height }`: a
    private img2img source the host stores UNSCANNED, because the orchestrator
    scans it when the workflow runs.

  🔴 `scanned` is the only verdict that clears an image for anyone but its author.
  `blocked` is the host refusing it and `error` is the host not answering —
  neither is a pass, so branch on `scanned`, never on "not blocked". Nothing
  becomes `scanned` without a readable image behind it, and a verdict this client
  cannot read is an `error` rather than a silence, because a dropped verdict
  leaves `scan()` waiting on a push the host has already sent.

  Shape differences from `@civitai/blocks-react`'s `useImageUpload`, both
  deliberate: there is one display mode rather than two, so no caller can hold an
  image that looks moderated without having asked for the verdict; and `scan()`
  carries no deadline of its own, matching the rest of this package — pass a
  `signal` for the bound your app wants. A host that predates the asynchronous
  flow replies with an already-moderated image, and that is read as the verdict it
  is rather than waiting on a push such a host will never send.

  The public surface this adds is `Host.openImageUpload` plus four types
  (`PendingImage`, `ImageScanResult`, `UploadedImage`, `SourceImage`), each
  reachable from that one signature. Nothing else.

- 81bd1b4: `host.publishGenerationOutputs` — publish outputs of one of this app's own
  workflows as public images, behind the host's confirmation. Resolves the ids of
  the rows the host created. Needs `ai:write:budgeted`: an app trusted to spend
  the viewer's Buzz on a generation is trusted to publish what that generation
  produced.

  🔴 **Outputs are named by INDEX, never by url, and that is the whole feature.**
  The block sends `workflowId` plus `imageIndexes`; the host re-derives that this
  viewer and this app own that workflow and resolves the orchestrator urls itself.
  A shape that let a block name a url would let a frame at an opaque origin
  publish an arbitrary blob under the viewer's account — a different, weaker
  feature wearing this one's name. The payload is therefore built field by field
  rather than spread from the caller's object, and the test asserts the wire's
  exact key set rather than the absence of one spelling.

  It waits on a person and nothing in this package cuts that short — the host
  holds its confirmation until the viewer acts, and a `signal` is how a caller
  bounds it. This is the same shape `openBuzzPurchase` already had; deadlines left
  this package wholesale, so there is no protocol timeout for a human-gated
  request to inherit.

  Three differences from `@civitai/blocks-react`'s `usePublishGenerationOutputs`,
  each for something the host does silently:

  - **A missing `workflowId` is refused here.** The host DROPS a request it cannot
    read, with no reply at all, and with no client deadline that call never
    settles.
  - **An unusable `imageIndexes` is refused here.** The host STRIPS a list it
    cannot read, and a stripped `imageIndexes` means publish EVERY output — so
    "publish these two" quietly becomes "publish all twenty", irreversibly.
  - **`title` is gone.** It reached the host's validator and was discarded before
    the mutation, so sending it did nothing end to end.

  A reply carrying neither ids nor a failure now rejects rather than resolving
  `undefined` out of a promise typed `number[]` — `error: ''` is how the host
  spells "no failure", so such a reply arrives as a success carrying nothing.

  ⚠ Publishing is best-effort per image, so `imageIds` can be SHORTER than the
  selection and nothing says which index dropped. Compare lengths rather than
  pairing ids to indexes.

- eea1907: `AppClient.storage` — the viewer's own per-app key/value store, on the same
  `http` instance `site` uses, so a `siteUrl` override redirects it too.

  `get` / `set` / `delete` / `list` / `getQuota` over
  `/api/v1/blocks/app-storage/*`. Three properties the surface is built around,
  because five fleet apps depend on them and one of those dependencies is a money
  decision:

  - **Every failure rejects.** No path resolves to mean "not written", and none
    resolves to mean "could not read". A malformed 2xx throws a `CivitaiError`
    rather than degrading to `null` or an empty page — an app that writes an
    in-flight claim before spending Buzz stands its double-charge backstop down on
    a scan that completed, and a manufactured empty page is indistinguishable from
    one.
  - **`nextCursor` is passed through untouched** — never defaulted, normalised, or
    re-derived from `keys.length`. Its absence is the caller's proof a scan
    finished.
  - **`updatedAt` is revived to a `Date` once, here**, which is where
    `@civitai/blocks-react` already put it, so the consumers compile unchanged.

  The public surface this adds is exactly `AppClient.storage` plus its six types
  (`StorageClient`, `StorageCallOptions`, `StorageKeyEntry`, `StorageListQuery`,
  `StorageListResult`, `StorageQuota`). Nothing else.

  No `isQuotaRefusal` helper: a size or quota refusal arrives as the already-public
  `ApiError` carrying `status`, so `error instanceof ApiError && error.status ===
413` is the same one-liner at the call site, and no consumer in the fleet
  branches on a storage status today. `@civitai/sdk/testing` is unchanged — the
  app-storage fake stays in this package's own test suite, because four of the five
  apps that store per-viewer state need knobs it does not have. Either can be
  promoted later; neither can be un-shipped.

## 0.2.0

### Minor Changes

- 266a021: Add `@civitai/sdk` — the Civitai SDK for block apps and external apps alike,
  and the successor to `@civitai/app-sdk` 0.x, which keeps its own releases.

  `const app = await initialize()` is the one entry point. In a block it waits for
  the host to hand over the viewer, the slot and a token, and rejects if no host
  answers; `initialize({ token })` is the same client for an app that holds an
  OAuth token.

  - `app.site` calls the public `/api/v1` REST API by path, retrying once with a
    fresh token on a 401 and throwing `ApiError`.
  - `app.orchestration` submits, estimates, reads, watches, waits for, cancels and
    queries workflows, carrying the orchestrator's own `WorkflowTemplate` and
    `Workflow`. `watchWorkflow` is an async generator that yields each change
    until the workflow finishes, on held reads rather than a polling interval.
  - `app.requestGrants(scopes)` asks for more scopes and resolves `false` when they
    cannot be granted.
  - `app.host`, in a block only, asks for the host's own UI: `requestSignIn`,
    `download`, `openResourcePicker`, `openBuzzPurchase`, `resize`, `reportError`,
    `navigate` and `onVisibilityChange` — every one a message the host answers
    today, checked against a snapshot of its handler inventory.

  Not yet end to end for blocks: the host still mints a block JWT that `/api/v1`
  and the orchestrator do not accept. `BREAKING.md` lists what the host has to
  change and what an app gives up moving off the bridge.

- 266a021: `createSignIn()` signs a viewer in with Civitai from a browser app outside
  civitai.com — PKCE against `auth.civitai.com`, no server, no client secret — and
  is what `initialize()` takes. Tokens stay in memory and refresh themselves;
  `requestGrants` goes back to Civitai for scopes not yet granted.

### Patch Changes

- 266a021: Blocks now start inside civitai.red and civitai.green, and reading the parent
  origins from the environment no longer bundles every other `VITE_*` variable
  into the app.
