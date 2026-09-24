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
| `GET_IMAGES_BY_IDS` | `GET /api/v1/blocks/images?ids=1,2,3` | Batch, up to **100** ids per request. Misses are reported by OMISSION — see below. 🔴 **Not `/api/v1/images`** — that is a `PublicEndpoint`; it ignores your token and answers with anonymous public results rather than erroring |
| `APP_STORAGE_*` | `POST /api/v1/blocks/app-storage/*` | **Routes exist** — five of them (`get`, `set`, `delete`, `list`, `quota`), civitai#5085. This row said "No v1 route"; that is no longer true. See *App storage* below |
| `SHARED_*` | `GET\|POST /api/v1/blocks/shared-storage/*` | **Routes exist** — eleven of them; see *Shared storage* below |
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

`GET /api/v1/blocks/images?ids=1,2,3` — up to **100** ids, matching the ceiling the `GET_IMAGES_BY_IDS` bridge message
already enforced.

🔴 **Misses are reported by omission.** An id you may not see and an id that does not exist are both simply
absent from `items`. That is deliberate: distinguishing them would leak whether a hidden image exists, which is
the same non-disclosure `BlockGatedImage` already makes when it collapses its gated verdict. Do not infer
deletion from absence.

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
   token**, and a general `/api/v1` call then fails as unauthorised rather than explaining itself.

   This file ships in the npm tarball and cannot be corrected after publication, so it deliberately does not
   record whether the flag is on today — that would be frozen into every published version.

   🔴 **You cannot reliably tell from inside the block why you got a block token.** The handshake carries an
   optional `token.kind` (`'block' | 'oauth'`), but it is optional in both senses — older hosts omit it, and
   the host also omits it when a re-mint does not match the instance — so its absence means nothing in
   particular. And `needsConsent` does not disambiguate: it is set for **any** signed-in viewer with an
   ungranted declared scope, whether or not the flag is on.

   So a block token can mean the flag is off, or that consent is outstanding, or that the viewer is
   anonymous, and the three are not separable from the client. **If you need to know, ask the platform team
   rather than inferring it.**

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
