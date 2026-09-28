# Breaking changes

What an app gives up or rewrites moving from `@civitai/app-sdk` 0.x (with
`@civitai/blocks-react`) to this package. Keep it current as the host and the
API catch up.

## Data moved from the bridge to the API

A block used to ask the host for data over `postMessage`. It now calls the
public `/api/v1` API (`app.site`) itself, with the token `initialize()` gives
it. `app.orchestration` reaches the orchestrator directly and is the escape
hatch for an app that is its own principal — a block submitting generations
uses the `blocks/workflows/*` routes instead, for the reasons below. Routes are added to `/api/v1` as apps need them, so several old
messages have no destination yet.

| Old message(s) | Now | Status |
|---|---|---|
| `GET_VIEWER` | `app.site.get('blocks/me')` | Route exists. 🔴 **Not `site.get('me')`** — that resolves to `/api/v1/me`, an `AuthedEndpoint` that does not accept a block token |
| `SUBMIT_WORKFLOW`, `ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`, `CANCEL_WORKFLOW`, `QUERY_APP_WORKFLOWS`, `CANCEL_APP_WORKFLOW` | `POST /api/v1/blocks/workflows/{submit,estimate,poll,cancel,query}` | **Routes exist.** 🔴 Use these, **not** `app.orchestration` — see *What a direct orchestrator call loses* below |
| `GET_IMAGES_BY_IDS` | `GET /api/v1/blocks/gated-images?ids=1,2,3` | Batch, up to **100** ids (`IMAGE_IDS_BATCH_MAX`); answers `{ images: BlockGatedImage[] }`. 🔴 **Not `blocks/images?ids=`** — that route's corpus is the exact complement of this one, so it answers EMPTY for every id an app published; see *Batch image fetch* below. 🔴 **Not `/api/v1/images`** — that is a `PublicEndpoint`; it ignores your token and answers with anonymous public results rather than erroring |
| `APP_STORAGE_*` | `POST /api/v1/blocks/app-storage/*` | **Routes exist** — five of them (`get`, `set`, `delete`, `list`, `quota`), civitai#5085. This row said "No v1 route"; that is no longer true. See *App storage* below |
| `SHARED_*` | `app.sharedStorage`, over `GET\|POST /api/v1/blocks/shared-storage/*` | **Routes exist** — eleven of them. `app.sharedStorage` wraps the **five** key/value ones; the higher-level ops are deliberately app-layer. See *Shared storage* below |
| `GET_BUZZ_BALANCE` | `GET /api/v1/blocks/buzz` | **Route exists.** Returns `{ blue, green, yellow }` — a bare object, three numbers |
| `GET_BUZZ_ACCOUNTS`, `GET_BUZZ_TRANSACTIONS` | — | No v1 route |
| `CREATE_POST_FROM_APP` | — | No v1 route, **and deliberately staying on the bridge** — see below |
| `PUBLISH_GENERATION_OUTPUTS` | `app.host.publishGenerationOutputs` | Same reasoning: it raises host UI, so it stays on the bridge — **carried** rather than replaced |
| `SET_COLLECTION_FOLLOW` | `POST /api/v1/blocks/collections/{id}/follow` | **Route exists** (scope `collections:write:self`). This row previously said "No v1 route"; that was wrong |
| `GET_DAILY_COMPENSATION`, `GET_WILDCARD_PACK`, `TRACK_EVENT` | — | Not carried |

⚠ `TRACK_EVENT` is filed above beside two one-consumer capabilities, which understates it: it is emitted by
`useBlockAnalytics`, which the fleet apps call widely. It is listed as *not carried* because **it has
no host handler today either** — `hostHandlerParity.ts` marks both hosts N/A, *"analytics fire-and-forget; no
host-side sink wired (dropped, never hangs)"*. So those call sites are already no-ops; this is net-new
capability rather than a migration gap.

## Scope binding is per-route

A route that declares a required scope binds **that scope, and only that one**, against your block context.
`GET /api/v1/models/{id}` declares `models:read:self` and 403s unless `?id` equals the model your block
renders beside; `GET /api/v1/blocks/buzz` declares `buzz:read:self` and does not look at your other scopes.

⚠ A route that declares **no** required scope binds nothing. `GET /api/v1/blocks/models` accepts any valid
block token, clamped only by the token's maturity ceiling — declaring `models:read:self` is not what gates
it, and requesting it for that route buys consent surface you do not need.

⚠ **This changed on 2026-09-23** (civitai#5063, fixed by #5067). Before that the check ran over *every* scope on
the token, so an unrelated declared scope could 403 a call — an app declaring `models:read:self` got
`models:read:self bound to different modelId` from `blocks/buzz`. **If you carry a workaround for that — a
`{ query: { id: context.modelId } }` passed to a route that does not use it — you can drop it.**

One thing remains token-wide, and it is deny-by-default: a token carrying a scope the platform does not
recognise is rejected outright. That is a registration-time mistake, which the manifest validator catches
first.

## Shared storage

Eleven routes under `/api/v1/blocks/shared-storage/`. Reads take `apps:storage:shared:read`, writes take
`apps:storage:shared:write` — both scopes already existed; neither is new.

### `app.sharedStorage` wraps FIVE of the eleven, on purpose

`app.sharedStorage` is a **generic cross-user key/value store**: `list`, `get` (the `/item` route, matching its
tRPC twin `apps.shared.get`), `append`, `update`, `withdraw`. An app no longer needs to hand-roll
`app.site.get('blocks/shared-storage/…')`, and the shape traps below are handled for it.

🔴 **`vote`, `unvote`, `counts`, `top`, `increment` and `report` are DELIBERATELY ABSENT from the client.**
The platform serves all eleven routes and will keep doing so — this is a surface decision, not a gap, and not
an oversight to be "fixed". Shared storage is scoped to generic key/value operations; the higher-level ops
belong at the app layer, where an app that wants voting, counters or reporting builds them on top of these
five. If demand shows up, the platform-side surface can be expanded again and the client can follow — but
**the routes existing is not a reason to add a method here.** Do not add one back without that decision being
revisited.

What survives the cut, and why: `SharedItem` still carries **`count` and `viewerVoted`** exactly as the two
read routes project them. Reading a tally is what makes an app-layer vote feature possible; only the
vote-casting operation is out of scope.

🔴 **It is not the per-viewer client's shape, in four ways.** Each is a real difference in the route table,
not a stylistic one, and assuming otherwise produces a bug that type-checks:

1. **The two reads are `GET` with a query string**; the three writes are `POST`. A read sent as POST is a `405`.
2. **`list` is enveloped** — `{ items, metadata: { nextCursor } }`. The cursor sits one level deeper than
   `app-storage/list`'s top-level `nextCursor`; read the wrong level and pagination is silently dead while
   every page still parses.
3. **`append` accepts no key** — the server mints a ULID, so one viewer cannot overwrite another's row.
4. **Anonymous viewers read but never write** — the inverse of per-viewer storage, where a missing subject
   refuses everything. See *Who may read, and who may write* below.

### Porting off the bridge: `useSharedStorage` → `app.sharedStorage`

`@civitai/blocks-react`'s `useSharedStorage` hook is what the fleet uses today, and it is **the left column of
the table at the top of this document, not a rival client of the right one.** It sends `SHARED_LIST`,
`SHARED_GET`, … over `postMessage` and never touches `/api/v1`; the host receives those messages and calls
tRPC `apps.shared.*` on the block's behalf. Its own doc says the block *"never sees the datastore credentials
and never sends its block token (the host injects both)"*.

`app.sharedStorage` is the other side of that migration: the transport becomes a direct `fetch` of
`/api/v1/blocks/shared-storage/*`, from the block's opaque origin, instead of a message to the host.

**The credential and the CORS declaration are already handled — for both, by code that exists.** `initialize()`
wires the host session into the client, `createHttp` puts `Authorization: Bearer <token>` on every request and
retries once on a `401` with a freshly fetched token, and the token still comes **from the host** over the
bridge (`REQUEST_TOKEN`) — the host continues to mint and rotate it. Scopes are unchanged between the two
transports (see above). So there is no token plumbing, no CORS work and no manifest change to do.

⚠ **The CORS mechanism differs by trust tier, though neither tier costs you any work.** An unverified block runs
without `allow-same-origin`, so it fetches from an **opaque origin** and the five routes' `allowOpaqueOrigin`
opt-in makes the server answer `ACAO: null`. An `internal`- or `verified`-tier block **does** get
`allow-same-origin`, so it fetches from its **real origin**, where that arm does not apply — it clears CORS via
the server's origin allowlist instead, which the platform populates itself from the publish-request approval
rather than anything an author configures.

The work that actually remains is four items, and it is all at the call sites:

1. **Narrow `value` from `unknown`** at every read site — see below.
2. **Move vote / counter / report logic into your app.** Those methods are not in this client at all; the
   platform routes still exist. See the deliberate-omission note above.
3. **Handle refusals as HTTP.** An `ApiError` carrying a `status`, where the bridge surfaced a rejected
   message — and the anon-write case is a `403` from the scope binding rather than anything the handler said.
   Read `message ?? error`; see *Error body* below.
   🔴 **But not every failure is an `ApiError`.** A request the browser blocks — a CORS rejection, a DNS or
   network failure — never reaches the response layer, so it surfaces as a **fetch `TypeError` with no
   `status` and no body**. A `catch` that assumes `ApiError` will read `undefined` for the status and report the
   wrong thing. The bridge had no such failure mode; this transport does. Branch on
   `error instanceof ApiError` first and treat the rest as transport failure.
4. **Audit every `limit` you pass** — the normalisation rules changed; see below.

⚠ **This paragraph has had three framings; two claims are retracted.** Recorded so the ground is not re-walked,
and scoped deliberately — each retraction covers only the words quoted, nothing adjacent:
**(a)** *"a second client for these same routes"* — **false**: the hook is the bridge/tRPC path and never
calls `/api/v1`, so the two are different transports, not two clients of one surface.
**(b)** *"budget for the token/CORS work"* — **false**: both the credential and the CORS declaration are already
handled, so that advice sent the reader's effort at finished infrastructure while demoting the real work.
🔴 The *transport* change is NOT retracted — this document still asserts it, above. The list above is what is
measured; nothing beyond it is claimed.

| | `useSharedStorage` (bridge) | `app.sharedStorage` (HTTP) |
|---|---|---|
| Transport | `postMessage` → host → tRPC `apps.shared.*` | direct `fetch` of `/api/v1/blocks/shared-storage/*` |
| Credential | host-injected | the SDK sends the host-minted token for you |
| Methods | 10, including `vote`/`unvote`/`count`/`report` | 5, key/value only |
| A listed row's `value` | `SharedAppendValue` — the typed write shape | `unknown` |
| `update` resolves | `void` | `{ ok: true }` |
| `list({ limit })`, out of range / non-integer / non-finite | **normalised**: clamped to 1…100, floored, or defaulted to 50 | **rejected — `400`** on all three |

🔴 **`limit` is the one that bites silently, and it is three changes, not one.** The bridge HOST normalised;
the REST route VALIDATES and refuses. Measured against the platform's own schema
(`z.coerce.number().int().min(1).max(100)`), each of these used to succeed and now `400`s:

- **Out of range** — `200` was clamped to 100, `0` was raised to 1. Both now reject.
- **Non-integer** — `2.5` was floored to 2. Now rejects.
- **Non-finite or not a number** — `NaN`, `Infinity`, `"abc"` and `""` all fell back to **50**. All now reject.
  🔴 **This is the one to grep for**: `Number(searchParams.get('n'))` on a missing param is `NaN`, which used
  to mean "just give me the default" and is now a failed request.

⚠ The `400` body is `{ error: 'Invalid query', details }`, and the SDK reads `error` first — so
`ApiError.message` is just **"Invalid query"**, naming neither the field nor the reason. The pointer is not
missing, only moved: **`ApiError.body.details`** carries zod's flattened field errors. Look there, not at
`.message`, when a read 400s.

Pass a value in range, or omit it and take the server's default. This client deliberately does **not** re-clamp:
the bounds are the server's, a second copy here is the thing that drifts, and a guard in this package enforces
that the module carries no numeric literal at all.

🔴 **The `value: unknown` is deliberate, and it is the wire-honest reading.** A row you list was written by some
OTHER viewer's copy of the app — possibly an older version, possibly a newer one — so its shape is a fact about
stored data, not a promise a client can keep. Typing it as the *write* shape asserts something nothing checked,
and it is wrong the moment one viewer ships a schema change. Narrow it at the call site.

Consequence: **a port is not an import swap** — but the cost is call-site work, not infrastructure. Narrow
`value`, move the vote/counter/report logic into your app, branch on `ApiError.status`, and check every `limit`.

| Method | Path | Scope |
|---|---|---|
| `GET` | `/list` | `…shared:read` |
| `GET` | `/item` | `…shared:read` |
| `GET` | `/counts` | `…shared:read` |
| `GET` | `/top` | `…shared:read` |
| `POST` | `/append` · `/update` · `/vote` · `/unvote` · `/withdraw` · `/report` · `/increment` | `…shared:write` |

### Who may read, and who may write

These rules are enforced server-side and are **not** new policy — the REST routes call the same functions the
bridge already called, so behaviour is identical on both transports.

- **Anonymous viewers MAY read** — by design. `list`, `item`, `counts` and `top` skip the subject check
  entirely. An anon read still requires: a valid block token, the `apps:storage:shared:read` scope, an
  approved app, a non-revoked instance, and the feature flag enabled.

  ⚠ **This was briefly broken and is fixed.** Until 2026-09-23 an app that *also* declared
  `apps:storage:shared:write` got a **403 on an anonymous read**, because the binding check ran over every
  scope on the token and reached the write scope's "requires authenticated subject" rule. civitai#5063, fixed
  by #5067 — binding is now per-route, so the read scope's own (absent) binding is all that applies.
  **Signed-out browsing works on REST; if you deferred a migration over this, it is unblocked.**
- **Anonymous viewers may NEVER write or vote.** An anon write is rejected by the write scope's own binding in
  `withBlockScope`, before the handler runs, so it surfaces as **`403`** rather than the handler's own `401`.
- **Authenticated writers must clear a minimum-trust gate.** After the anon check, writes call
  `assertSharedWriteTrust` — account age, paid tier, and verified email *or* a linked OAuth account. A signed-in
  viewer is not automatically a permitted writer.
- **Tenancy is structural, not checked.** Every query interpolates a schema name derived from the **verified
  token**, never from client input. An app cannot address another app's shared storage because it cannot name it.
- **Rate limits are per-operation and per-namespace**, so one operation cannot starve another — browsing a feed
  cannot exhaust a viewer's ability to delete their own rows.

### Error body

🔴 **Which key carries the reason depends on WHERE the request died, so read both.** There are three shapes:

| Refused by | Body |
|---|---|
| `withBlockScope` — bad token, revoked instance, unapproved app, missing scope, failed binding | `{ error }` **only** |
| a route's own prologue — wrong method, missing param | `{ error }` only |
| the service layer, through the shared error chokepoint | `{ message }` |
| `restErrorBody` | `{ error, message, code }` |

An earlier version of this section said to write clients against `{ message }` and treat `{ error }` as legacy.
**That is wrong**: every middleware rejection — including the anonymous-write 403 above — carries no `message`
at all, so a client following it logs `undefined` for the refusals it most needs to see. Read
`message ?? error`, and treat the HTTP status as the thing you branch on.

The chokepoint does matter for one thing, and that part stands: the newer routes do not forward a raw database
error string, which on this surface can name the app's schema and the offending row value.

## App storage

Five routes under `/api/v1/blocks/app-storage/` — `get`, `set`, `delete`, `list`, `quota` (civitai#5085).
Reads take `apps:storage:read`, writes take `apps:storage:write`. The SDK wraps them as `AppClient.storage`.

⚠ **The migration delta: anonymous viewers get 403, where the bridge resolved an anonymous read to `null`.**
Gate on `viewer` rather than reading an empty result as "nothing stored". Whether 403 is the intended policy
per operation is open as civitai#5089.

`updatedAt` is still revived to a `Date` by the client, as `useAppStorage` did, so consumers need no change.

The client's own contract — block-token-only, every-failure-rejects, `nextCursor`, and the wire-vs-stored
distinction between `set`'s `sizeBytes` and `getQuota`'s `usedBytes` — is in **README.md § App storage** and
in the TSDoc that generates `api/public-api.md`. That TSDoc is regenerated and diffed by `api:check` in CI, so
it is the copy that cannot rot; this file deliberately does not restate it.

## Batch image fetch

`GET /api/v1/blocks/gated-images?ids=1,2,3` → `{ images: BlockGatedImage[] }` — up to **100** ids
(`IMAGE_IDS_BATCH_MAX`), matching the ceiling the `GET_IMAGES_BY_IDS` bridge message already enforced. Any valid
block token; no required scope.

This is the per-viewer GATED read, and it is the replacement for `GET_IMAGES_BY_IDS`. Given the image ids an app
stored — a benchmark grid, a generator's cover image, a gallery panel — it answers, PER REQUESTING VIEWER, which
of them that viewer may be shown, with a host-minted moderated edge url for exactly those.

🔴 **THERE ARE TWO IMAGE ROUTES AND THEY ARE NOT INTERCHANGEABLE. `blocks/images?ids=` CANNOT SERVE THIS CASE —
it answers EMPTY for every id an app published, at any ceiling, for any viewer, forever.** The reason is that the
two corpora are DISJOINT, not that the two routes disclose differently:

- `blocks/images` serves `runImageSearch` over the Meilisearch images index, whose source query hard-filters
  `i."postId" IS NOT NULL` (`civitai:src/server/search-index/images.search-index.ts:134`, and `:282` for the
  incremental update pass).
- `blocks/gated-images` is the exact complement — `AND i."postId" IS NULL`
  (`civitai:src/server/services/blocks/block-gated-images.service.ts:184`), further scoped to
  `blockPublishedAppId = claims.appId`.

Complementary predicates: an image cannot satisfy both. And because `blocks/images` reports misses **by
omission** (below), substituting it fails SILENTLY — `200` with an empty list, never an error. A port that uses
it renders nothing and looks healthy. The authority on this is the docblock of
`civitai:src/pages/api/v1/blocks/gated-images.ts`, which exists to answer exactly this question.

🔴 **`blocks/images` is a catalog SEARCH route** — it shares `runImageSearch` with the public `/api/v1/images`,
its `?ids=` is a FILTER over that search, and it is the right route when you are querying the public catalog. On
that corpus **misses are reported by omission**: an id you may not see and an id that does not exist are both
simply absent. That is deliberate there — the corpus is the whole public catalog, so confirming that a withheld
id exists would itself be the disclosure. Do not infer deletion from absence, and do not read the omission rule
as applying to `gated-images`, which collapses its gated verdict into `BlockGatedImage` instead.

## Post creation stays on the bridge

`CREATE_POST_FROM_APP` and `PUBLISH_GENERATION_OUTPUTS` are **not** getting a plain REST equivalent, and this is
a decision rather than a backlog item.

The host confirmation is not a dialog an app could reproduce. The server returns a preview; the write echoes
`confirmedImageCount` **from that server preview**; and the host refuses the write on mismatch. A bare
`POST /posts` would let a block draw its own confirmation inside an iframe at an opaque origin, with nothing
binding what the viewer was shown to what gets written. Moving it would remove a consent control, not relocate
one.

If a REST surface is ever needed, the defensible shape is a route returning a short-lived server-signed publish
intent that host chrome redeems after showing the preview — so the host stays in the loop by construction.

`PUBLISH_GENERATION_OUTPUTS` is on `app.host` for exactly that reason: staying on the bridge is the decision,
and `app.host` is where a bridge message lives. Its own version of the binding is the index — the block names a
workflow and positions in it, and the host resolves the urls from the workflow it has verified the block owns,
so there is no url for a frame to supply. `CREATE_POST_FROM_APP` is not carried; nothing in the fleet calls it
that `publishGenerationOutputs` does not already serve.

## What a direct orchestrator call loses

🔴 **This is the sharpest trap in the migration, because the wrong version compiles.** Substituting
`app.orchestration` for the block workflow routes **type-checks and passes tests**; what it drops is
server-side policy that no local check can miss.

Submitting through the host went through civitai's own `blocks.submitWorkflow`,
which added controls a direct call does not get:

- **Spend caps.** A per-call `buzzBudget`, a per-viewer daily cap and a per-app
  daily cap, all enforced by civitai. A direct call has only the orchestrator's
  per-token budget, taken from the viewer's consent.
- **The maturity clamp.** The block path applies the viewer's browsing-level
  ceiling. A direct call does not.
- **Attribution.** civitai tagged each workflow with the app and block it came
  from. The orchestrator records the token's OAuth client internally but not on
  the workflow, so per-app reporting needs an orchestrator change.

✅ **The `/api/v1/blocks/workflows/*` routes keep all of it** — they delegate to the same procedures the
bridge called. They are the replacement; `app.orchestration` is the raw orchestrator and is the escape hatch
for an app that is genuinely its own principal.

⚠ Same shape, one level subtler: `orchestration.queryWorkflows({ tags })` versus
`POST /api/v1/blocks/workflows/query`. The **route forces the app tag server-side from the verified token**;
the client takes `tags` from the caller. Swapping one for the other relocates a trust boundary into the
iframe, and nothing about the call site looks different.

## Host UI still carried

On `app.host`: `requestSignIn`, `download` (was `SAVE_IMAGE`),
`openResourcePicker`, `openBuzzPurchase`, `openImageUpload`,
`publishGenerationOutputs`, `resize`, **`autoResize`**, `reportError`, `navigate`
and `onVisibilityChange`. Reach for `autoResize(element)` over bare `resize` —
it wires the `ResizeObserver` for you and returns a stop function. Consent is `app.requestGrants` (was `requestConsent`).

`publishGenerationOutputs` keeps `usePublishGenerationOutputs`'s wire exactly —
`workflowId` plus `imageIndexes`, never a url — and drops one field. `title`
reached the host's validator and was then discarded before the mutation, so
sending it was a no-op end to end; a field that does nothing is not worth a
version commitment. Two client-side refusals are new, and both are for
something the host does silently: a missing `workflowId` is DROPPED with no
reply at all, which without a client deadline is a hang; and an `imageIndexes`
the host cannot read is STRIPPED, and a stripped `imageIndexes` means publish
every output.

`openImageUpload` differs in shape from `useImageUpload`, twice:

- **There is one display mode, the asynchronous one.** The hook also had a
  blocking variant whose return looked moderated; here a public upload always
  resolves a `PendingImage` and the verdict comes from its `scan()`, so no
  caller ends up holding an image that looks cleared without having asked. A
  host predating `asyncScan` replies with a moderated image instead, and that
  is read as the verdict it already is — `scan()` answers rather than waiting
  on a push no such host will send.
- **`scan()` has no deadline of its own.** The hook gave up after ten minutes
  and called that a retryable error. Client deadlines left with all the others
  (see *Behaviour* below) — pass a `signal` for the bound your app wants.

Not carried: `OPEN_CHECKPOINT_PICKER` (use `openResourcePicker` with
`resourceType: 'Checkpoint'`).

⚠ **`SET_USER_CHECKPOINT` is carried after all**, as `POST /api/v1/blocks/user-checkpoint/set` — the route's
own docstring calls itself its REST twin. Pass `versionId: null` to clear. It remains inert on a page surface,
which is what the old "not carried" line was reaching for, but a model-slot block can persist through it.

## Behaviour

| What | Before | Now |
|---|---|---|
| Host failures | free-text `error` on each reply | `BridgeError` with a `code` |
| Request deadlines | per-message client timeouts | none; pass an `AbortSignal` |
| A refused grant | rejected | resolves `false` |
| React hooks | 37 | none — plain functions; bind them in your framework |

## Waiting on the host

For a block to use the API at all, civitai has to:

1. ~~Mint an OAuth access token for the app's own client (`appblk-<slug>`) and
   send it in `BLOCK_INIT` and `TOKEN_REFRESH`, instead of or beside the block
   JWT.~~
   ⚠ **BUILT, AND DARK.** The manifest gained an `auth` field
   (`"block-token"` | `"oauth"`, default `"block-token"`) in the canonical schema; `block-oauth-scope.ts`
   and `/api/v1/block-tokens` mint an OAuth app token when a manifest asks for it.

   🔴 **But the mint is FLAG-GATED, and the failure is silent.** The call site is
   `manifestWantsOauthToken(app.manifest) && env.APP_BLOCK_OAUTH_TOKENS_ENABLED`, and that env var is
   `.default(false)`. **Wherever it is off, a manifest declaring `auth: "oauth"` silently receives the BLOCK
   token**, and a general `/api/v1` call then fails as unauthorised. Since the SDK narrowed its token-kind
   guard, that refusal carries the explanation: `app.site` appends the `auth: "oauth"` opt-in to the API's own
   401/403 on any route outside `blocks/*`, and `app.orchestration` refuses before the request. `initialize()`
   itself no longer rejects — being handed the block token is the DEFAULT here, not a failure, and rejecting it
   also blocked the `consent_required` prompt below.

   This file ships in the npm tarball and cannot be corrected after publication, so it deliberately does not
   record whether the flag is on today — that would be frozen into every published version.

   **What you can tell from inside the block, and what you cannot:**

   | signal | means |
   |---|---|
   | `viewer === null` | an anonymous viewer. Definitive — no OAuth token is minted for one, whatever the flag. Gate on this; it is a frozen wire field |
   | signed in, `token.kind === 'oauth'` | the mint succeeded, so the flag is on for you |
   | signed in, `token.kind` absent or `'block'` | **not separable.** Could be the flag, or a scope this viewer has not granted. `kind` is optional and hosts predating hub-minted OAuth omit it |

   The third row is the one to design around: it is the ordinary case today, and a block cannot tell those two
   apart. What it CAN do is the thing the platform expects either way — treat the rejection as a prompt to
   sign in or to request consent, rather than as a configuration question. `app.requestGrants()` reaches the
   host's consent dialog on a block token, so that prompt is available from a block that holds one.

   ✅ **The phishing finding is not re-opened**, which is why this could ship at all. The token is minted
   **server-side** by the host (`mintOauthAppToken`) against scopes already approved for the app; the
   `appblk-*` bar on the auth hub's **interactive** authorization-code and device flows stands untouched.
   That bar was never the blocker for this path — driving the consent screen was.

   ⚠ Still true, and still the cheaper route for most apps: the block JWT is **not** limited to
   `/api/v1/blocks/*` by any route or claim check — it works wherever a handler is wrapped. Today that is
   most `/api/v1/blocks/*` routes plus `/api/v1/models/{id}` — the 35 routes wrapped in `withBlockScope`.
   🔴 **Not `/api/v1/me`**, which is an `AuthedEndpoint`; blocks use `/api/v1/blocks/me`. And four `blocks/*`
   routes (`dev-token`, `submissions`, `submit-version`, `withdraw`) are not wrapped either. Widening what the existing block token is accepted on reaches most destinations without
   OAuth at all. The question that decides between the two is whether a block must act **without an open host
   page**: the block JWT lives ~15 minutes and is refreshed by the host page's session, so the block holds no
   refresh credential of its own. If background work is required, OAuth becomes necessary rather than
   optional.

2. ~~Let a browser send `Authorization` to `/api/v1` from the app's registered origins.~~
   ✅ **DONE** — shipped 2026-09-22 (civitai#5028). `Authorization` is named explicitly in the allowed-headers
   list, because a `*` wildcard does not cover it. Note `/api/v1/blocks/*` was never affected; it has carried
   its own origin-allowlisted CORS since May.

3. Add the `/api/v1` routes above as apps need them, and scope checks.

   Largely done — shared storage, Buzz balance, batch images, collections, gated images, generation
   resources, tips, the workflow routes and **per-app-user storage** (`APP_STORAGE_*`, civitai#5085) have all
   landed.

   What remains is not storage: `GET_BUZZ_ACCOUNTS` / `GET_BUZZ_TRANSACTIONS`, `GET_DAILY_COMPENSATION`,
   and `GET_WILDCARD_PACK`. `OPEN_IMAGE_UPLOAD` now has an SDK host request (`app.host.openImageUpload`,
   see *Host UI still carried*); what it has no twin of is a REST route, and it is not getting one.

   ⚠ **Scope checks are a separate item and are not a prerequisite for the routes above.** Every block scope
   these routes need already exists, is consent-described and is context-bound, so each route is scope-gated on
   arrival. What is missing is OAuth `TokenScope` enforcement on the *general* `/api/v1` surface: it is applied
   by a tRPC middleware only, and the REST wrappers resolve a bearer token's scope onto the request and then
   never read it back. Five routes check a scope by hand; everything else does not.

And the orchestrator has to check that a workflow belongs to the caller before
reading, changing or deleting it, which it does not today.

⚠ **Sequencing note for anyone porting generation:** the `blocks.*` bridge path applies host-side checks that a
direct orchestrator call does not. Porting an app's generation calls off the bridge is therefore not a
transport-only change, and should be sequenced after the item above rather than before it.
