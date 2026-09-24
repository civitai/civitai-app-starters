# Breaking changes

What an app gives up or rewrites moving from `@civitai/app-sdk` 0.x (with
`@civitai/blocks-react`) to this package. Keep it current as the host and the
API catch up.

## Data moved from the bridge to the API

A block used to ask the host for data over `postMessage`. It now calls the
public `/api/v1` API (`app.site`) and the orchestrator (`app.orchestration`)
itself, with the token `initialize()` gives it. Routes are added to `/api/v1` as apps need them, so several old
messages have no destination yet.

| Old message(s) | Now | Status |
|---|---|---|
| `GET_VIEWER` | `app.site.get('me')` | Route exists |
| `SUBMIT_WORKFLOW`, `ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`, `CANCEL_WORKFLOW`, `QUERY_APP_WORKFLOWS`, `CANCEL_APP_WORKFLOW` | `app.orchestration` | Works with an OAuth token |
| `GET_IMAGES_BY_IDS` | `GET /api/v1/images?ids=1,2,3` | Batch, up to **100** ids per request. Misses are reported by OMISSION — see below |
| `APP_STORAGE_*` | — | No v1 route |
| `SHARED_*` | `GET\|POST /api/v1/blocks/shared-storage/*` | **Route exists** — nine of them; see *Shared storage* below |
| `GET_BUZZ_BALANCE` | `GET /api/v1/blocks/buzz` | **Route exists.** Returns `{ blue, green, yellow }` — a bare object, three numbers |
| `GET_BUZZ_ACCOUNTS`, `GET_BUZZ_TRANSACTIONS` | — | No v1 route |
| `CREATE_POST_FROM_APP` | — | No v1 route, **and deliberately staying on the bridge** — see below |
| `PUBLISH_GENERATION_OUTPUTS` | `app.host.publishGenerationOutputs` | Same reasoning: it raises host UI, so it stays on the bridge — **carried** rather than replaced |
| `SET_COLLECTION_FOLLOW` | `POST /api/v1/blocks/collections/{id}/follow` | **Route exists** (scope `collections:write:self`). This row previously said "No v1 route"; that was wrong |
| `GET_DAILY_COMPENSATION`, `GET_WILDCARD_PACK`, `TRACK_EVENT` | — | Not carried |

⚠ `TRACK_EVENT` is filed above beside two one-consumer capabilities, which understates it: it is emitted by
`useBlockAnalytics`, used by **all 7 fleet apps across 40 files**. It is listed as *not carried* because **it has
no host handler today either** — `hostHandlerParity.ts` marks both hosts N/A, *"analytics fire-and-forget; no
host-side sink wired (dropped, never hangs)"*. So those 40 call sites are already no-ops; this is net-new
capability rather than a migration gap.

## 🔴 Before you call ANY block REST route: the scope-binding trap

The request-time scope-binding check runs over **every scope on your block token**, not just the one the route
requires. So a scope you declared for an unrelated feature can reject a call that has nothing to do with it,
with an error naming a scope you never invoked.

The common case: an app declaring **`models:read:self`** calls `GET /api/v1/blocks/buzz`. That scope's binding
wants `query.id` (or `query.modelId`) to match the model in your block context; a buzz request carries neither,
so it **403s** with `models:read:self bound to different modelId`.

**Workaround — pass a param the handler ignores:**

```ts
await app.site.get('blocks/buzz', { query: { id: context.modelId } });
```

Applies to all ten current block REST routes (`blocks/buzz` and the nine under `blocks/shared-storage/`).
Tracked as civitai/civitai#5063. The anon-read case below is the same bug with no workaround.

## Shared storage

Nine routes under `/api/v1/blocks/shared-storage/`. Reads take `apps:storage:shared:read`, writes take
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

  🔴 **BUT NOT TODAY, if your app also declares `apps:storage:shared:write`.** An anon token still carries
  that scope (it is consent-exempt, so the anon mint does not strip it), and the request-time scope-binding
  check runs over **every** scope on the token rather than the one the route needs — so it reaches the write
  scope's "requires authenticated subject" rule and returns **403 for an anonymous read**.

  There is no call-site workaround: an app cannot un-declare the write scope it needs in order to make its
  read path work. Tracked as civitai/civitai#5063.

  ⚠ **This is a behaviour change from the bridge, so check it before porting.** `SHARED_*` over `postMessage`
  gates anonymity **per operation** — an anon read passes there today. On REST it currently does not. If your
  app's premise is signed-out browsing, that path breaks on migration until #5063 lands.
- **Anonymous viewers may NEVER write or vote.** Every write resolves to `401` for an anon subject.
- **Authenticated writers must clear a minimum-trust gate.** After the anon check, writes call
  `assertSharedWriteTrust` — account age, paid tier, and verified email *or* a linked OAuth account. A signed-in
  viewer is not automatically a permitted writer.
- **Tenancy is structural, not checked.** Every query interpolates a schema name derived from the **verified
  token**, never from client input. An app cannot address another app's shared storage because it cannot name it.
- **Rate limits are per-operation and per-namespace**, so one operation cannot starve another — browsing a feed
  cannot exhaust a viewer's ability to delete their own rows.

### Error body

The nine routes return `{ message }` on a 4xx. ⚠ The two oldest siblings (`top`, `increment`) return `{ error }`.
That divergence is deliberate: the newer routes go through the shared error chokepoint rather than forwarding a
raw database error string, which on this surface can name the app's schema and the offending row value. Write
clients against `{ message }`; treat `{ error }` as legacy.

## Batch image fetch

`GET /api/v1/images?ids=1,2,3` — up to **100** ids, matching the ceiling the `GET_IMAGES_BY_IDS` bridge message
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

Submitting through the host went through civitai's own `blocks.submitWorkflow`,
which added controls a direct call does not get:

- **Spend caps.** A per-call `buzzBudget`, a per-viewer daily cap and a per-app
  daily cap, all enforced by civitai. A direct call has only the orchestrator's
  per-token budget, taken from the viewer's consent.
- **Attribution.** civitai tagged each workflow with the app and block it came
  from. The orchestrator records the token's OAuth client internally but not on
  the workflow, so per-app reporting needs an orchestrator change.

## Host UI still carried

On `app.host`: `requestSignIn`, `download` (was `SAVE_IMAGE`),
`openResourcePicker`, `openBuzzPurchase`, `openImageUpload`,
`publishGenerationOutputs`, `resize`, `reportError`, `navigate` and
`onVisibilityChange`. Consent is `app.requestGrants` (was `requestConsent`).

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
`resourceType: 'Checkpoint'`), `SET_USER_CHECKPOINT` (inert on a page).

## Behaviour

| What | Before | Now |
|---|---|---|
| Host failures | free-text `error` on each reply | `BridgeError` with a `code` |
| Request deadlines | per-message client timeouts | none; pass an `AbortSignal` |
| A refused grant | rejected | resolves `false` |
| React hooks | 38 | none — plain functions; bind them in your framework |

## Waiting on the host

For a block to use the API at all, civitai has to:

1. Mint an OAuth access token for the app's own client (`appblk-<slug>`) and
   send it in `BLOCK_INIT` and `TOKEN_REFRESH`, instead of or beside the block
   JWT. The auth hub currently bars `appblk-*` clients from its flows.

   🔴 **That bar is deliberate security, not an oversight.** App-block clients exist only as the policy ceiling
   for block-token minting; letting them drive the interactive authorization-code or device flows would mint a
   real account bearer token, and an app-block owner could phish a viewer through the consent screen into
   account takeover. The bar is enforced in four places, the load-bearing one being an empty `grants` list
   written into the client row at approve time. **Removing it is re-opening a signed-off security finding, not
   a config change.**

   ⚠ There may be no need to. The block JWT is **not** limited to `/api/v1/blocks/*` by any route or claim check
   — it works wherever a handler is wrapped, and `GET /api/v1/models/{id}` is already dual-auth today. Widening
   what the existing block token is accepted on may reach the same destination without touching OAuth at all.
   The question that decides between the two paths is whether a block must act **without an open host page**:
   the block JWT lives ~15 minutes and is refreshed by the host page's session, so the block holds no refresh
   credential of its own. If background work is required, OAuth becomes necessary rather than optional.

2. ~~Let a browser send `Authorization` to `/api/v1` from the app's registered origins.~~
   ✅ **DONE** — shipped 2026-09-22 (civitai#5028). `Authorization` is named explicitly in the allowed-headers
   list, because a `*` wildcard does not cover it. Note `/api/v1/blocks/*` was never affected; it has carried
   its own origin-allowlisted CORS since May.

3. Add the `/api/v1` routes above as apps need them, and scope checks.

   Partially done — shared storage, Buzz balance and batch images have landed; per-app-user storage
   (`APP_STORAGE_*`) is the largest remaining gap at 5 of 7 fleet apps.

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
