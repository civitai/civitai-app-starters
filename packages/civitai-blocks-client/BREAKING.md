# Breaking changes

What an app loses or has to rewrite when it moves from `@civitai/blocks-react` +
`@civitai/app-sdk` to `@civitai/blocks-client`, and which parts of the host
bridge this package does not carry. Nothing here is settled by omission — an
entry marked **undecided** is a thing we have looked at and not yet chosen.

Keep this current when a domain lands or a decision is taken.

## Behaviour that changed for things that *are* ported

| What | Before | Now | Why |
|---|---|---|---|
| Failures | free-text `error` string on each reply | `BridgeError` with a `code` (`forbidden`, `insufficient`, …) | a caller can branch without matching prose |
| Request deadlines | per-message client timeouts (e.g. 30s, 10min) | none; the caller may pass an `AbortSignal` | the host owes a reply to every request it accepts, so the deadline is its to set |
| Paging | caller threads a `cursor` back | async generators; the cursor never surfaces | the host returns the buzz cursor as a `Date` while declaring it a `string` |
| `getViewer()` | resolves with nothing useful for an anonymous viewer | rejects `unauthenticated` | pairs with `requestSignIn()`; an empty result has no remedy |
| Workflow shapes | `BlockWorkflowSnapshot` | `@civitai/orchestration-client`'s own `Workflow` / `WorkflowTemplate` | a step the orchestrator gains needs no release here |
| React hooks | 38 hooks | none — plain functions, `Live<T>` for shared reads | the package is framework-free by construction |

## Not yet spoken by the host

`buzz` and `orchestration` were rebuilt on a protocol this package owns
(`BUZZ_*`, `ORCHESTRATION_*`). **No host handler exists for any of it**, so both
domains are non-functional against production until the host implements them.
The old messages they replace — `GET_BUZZ_BALANCE`, `GET_BUZZ_ACCOUNTS`,
`GET_BUZZ_TRANSACTIONS`, `OPEN_BUZZ_PURCHASE`, `SUBMIT_WORKFLOW`,
`ESTIMATE_WORKFLOW`, `POLL_WORKFLOW`, `CANCEL_WORKFLOW` — are deliberately not
sent.

`storage` and `viewer` carry the host's existing messages unchanged and work
today.

## Not ported

### `SHARED_*` — the community datastore · **undecided**

Ten messages: `SHARED_GET` `SHARED_LIST` `SHARED_APPEND` `SHARED_UPDATE`
`SHARED_WITHDRAW` `SHARED_VOTE` `SHARED_UNVOTE` `SHARED_GET_COUNT`
`SHARED_GET_COUNTS` `SHARED_REPORT`.

An app-global, append-only, moderated list with voting — `shared_kv` keyed by a
server-generated ULID, `votes` (one row per key+user), a `counters` tally cache
and a report table. Unlike the per-viewer `kv`, rows are visible to every viewer
of the app and carry no `block_instance_id`, so the app itself is the rendezvous
point.

Deferred for two reasons, both worth revisiting rather than assuming:

- **It is a product feature, not a storage primitive.** The value shape is fixed
  at `{ title, body?, data? }`, voting is in the schema, and the surrounding
  controls — a blocking content-safety pass on append, a min-trust gate, per-user
  row caps, daily rate limits, moderator soft-hide — all exist because the payload
  is public user-generated text. It was built for particular apps (a benchmarking
  grid, request boards).
- **There are no signals.** Every `SHARED_*` message the host sends is a reply;
  there is no push. A viewer cannot see another viewer's vote without re-reading,
  so a vote count is stale the moment it renders. A `watchShared*` would have to
  be a polling loop wearing a `watch` name, which is the one thing this package
  has refused to do elsewhere.

**Revisit when** an app actually needs a request board, or if the host gains a
fan-out push for shared rows — that second one is what would make a live view
honest, and is worth raising with whoever owns the bridge regardless.

### Media · **undecided**

`OPEN_IMAGE_UPLOAD` `SAVE_IMAGE` `GET_IMAGES_BY_IDS`
`PUBLISH_GENERATION_OUTPUTS` `CREATE_POST_FROM_APP`, plus the
`IMAGE_SCAN_RESOLVED` push (which reuses its request's `requestId` — the
transport already guards against answering the upload with the scan verdict).

The output pipeline: what turns a generation into something on-site. Deferred
because these are host-chrome flows where a human sits in a modal for an
unbounded time, and because they are the messages most likely to change shape
when the host work happens. `requestPurchase` is the precedent for the API shape
— a request that resolves with an outcome rather than throwing on abandonment.

### Pickers · **undecided**

`OPEN_RESOURCE_PICKER` `OPEN_CHECKPOINT_PICKER` `SET_USER_CHECKPOINT`
`GET_WILDCARD_PACK`, plus the `USER_CHECKPOINT_SET` push. Same reasoning as
media. Note `pickerOverlay.ts` in `blocks-react` appends its modal to
`document.body`, which is a portal a shadow-DOM element cannot style — relevant
when `@civitai/elements` needs a picker.

### App workflow history · **undecided**

`QUERY_APP_WORKFLOWS` `CANCEL_APP_WORKFLOW`. App-scoped listing, distinct from
`orchestration`'s per-workflow reads. Probably belongs inside `orchestration`
rather than as its own domain.

### Odds and ends

| Message | Status |
|---|---|
| `SET_COLLECTION_FOLLOW` | **undecided** — one message, social graph |
| `GET_DAILY_COMPENSATION` | **undecided** — creator daily comp, buzz-adjacent |
| `NAVIGATE` | **undecided** — deep-link within the app's own sub-path space |
| `TRACK_EVENT` | **not planned** — the page host has no sink wired; it is dropped on arrival |

### Lifecycle reachable but unnamed

`SUSPEND` / `RESUME` (page visibility) and `BLOCK_ERROR` arrive and depart
through the transport but have no domain API: a consumer reaches them with
`transport.on('SUSPEND', …)` and `transport.notify({ type: 'BLOCK_ERROR', … })`.
`REQUEST_TOKEN` — a block asking for a fresh token rather than waiting for the
host's ~13-minute rotation — is **not implemented**; the transport only applies
host-pushed `TOKEN_REFRESH`.

## The handshake is now owned here

`core/handshake.ts` carries the wire types the host sends at init, the messages
the transport itself acts on (`BLOCK_INIT`, `TOKEN_REFRESH`,
`TOKEN_REFRESH_RESPONSE`, `THEME_CHANGE`) and the init-fragment parsing.
`@civitai/app-sdk` is no longer a dependency of any kind — **installing this
package no longer requires it**.

The shapes are still the host's and must track it; owning them buys the freedom
to shape the protocol without waiting on another package's release. Two
deliberate departures so far:

- **`blockId` and `appId` are not declared.** The host still sends them and must
  keep doing so (a deployed validator rejects a payload without them), but they
  are build-time identity a block reads from its own manifest, with no consumer
  across the platform's own blocks.
- **`isMessage` narrowed to `isHostMessage`**, over the four messages this
  transport acts on rather than the host's whole union.

### Init-time identity disclosure · **undecided**

`ViewerInfo` (`id`, `username`) and `PageSlotContext.viewerUserId` /
`viewerUsername` are ported faithfully, so `BLOCK_INIT` still hands every block
the viewer's identity unconditionally on load. Now that `viewer.getViewer()`
exists — scope-gated and audited per call — this package could simply stop
declaring those fields and let the host keep sending them unread. That is a
posture change, not a port, so it is recorded rather than taken.
