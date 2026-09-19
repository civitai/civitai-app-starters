# Breaking changes

What an app loses or has to rewrite when it moves from `@civitai/blocks-react` +
`@civitai/app-sdk` to `@civitai/blocks-client`, and which parts of the host
bridge this package does not carry. Nothing here is settled by omission — an
entry marked **undecided** is a thing we have looked at and not yet chosen.

Keep this current when a domain lands or a decision is taken.

## How this file stays honest

`npm run check:parity` checks every message this package sends against
`snapshots/host-messages.json` — a committed capture of the host's own
`hostHandlerParity.ts`, refreshed with `npm run snapshot:host` from a checkout of
civitai/civitai. It fails when we send something no host handler answers, when a
legacy reply is expected under the wrong name, and when the host implements one
of the messages listed below as awaiting it. Dropping `@civitai/app-sdk` removed
the compiler from that job; this is what replaces it.

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

20 of the host's 46 block→host messages are carried. The rest were looked at and
left out; none of it is an oversight.

| Message(s) | Why not | Revisit when |
|---|---|---|
| `SHARED_*` (10) | A community feature, not a storage primitive — and it emits no signals | An app needs a request board, **or** the host adds a fan-out push |
| `GET_DAILY_COMPENSATION` | A creator-earnings report, not a capability | A creator-dashboard block exists |
| `GET_WILDCARD_PACK` | Prompt-list pack import; one app shape | An app imports wildcard packs |
| `SET_COLLECTION_FOLLOW` | One social verb, no caller | An app shows a collection |
| `TRACK_EVENT` | The page host has no sink; it is dropped on arrival | The host wires one |
| `QUERY_APP_WORKFLOWS`, `CANCEL_APP_WORKFLOW` | Superseded by `orchestration` — see below | — |
| `REQUEST_TOKEN` | Its only use is the direct-fetch path, which we would rather not encourage — see below | The REST-vs-bridge question below is settled |
| `OPEN_IMAGE_UPLOAD` (+ `IMAGE_SCAN_RESOLVED`) | A blocks-only uploader that takes images when the site takes media — see below | The host routes blocks through its own media upload |
| `OPEN_RESOURCE_PICKER`, `OPEN_CHECKPOINT_PICKER`, `SET_USER_CHECKPOINT` | A picked resource cannot be fed into this package's own submit path — see below | `RESOURCE_PICKER_RESULT` carries the resource's AIR |
| `GET_IMAGES_BY_IDS`, `PUBLISH_GENERATION_OUTPUTS`, `CREATE_POST_FROM_APP` | Nothing in this package produces the ids they take, and publishing has two paths of unequal quality — see below | The publish path is one design, not two |

None of the first five has a caller in any app in this workspace. Adding any one back
is an afternoon — the protocol file, the domain function, its tests — and the
parity guard keeps them visible, because they stay in the host snapshot as
messages we deliberately do not send.

### `SHARED_*`, in more detail

An app-global, append-only, moderated list with voting: `shared_kv` keyed by a
server-generated ULID, `votes` (one row per key+user), a `counters` tally cache,
a report table. Rows carry no `block_instance_id`, so every install of the app
shares one list.

Two reasons it is out:

- **It is a product feature.** The value shape is fixed at `{ title, body?, data? }`,
  voting is in the schema, and the controls around it — a blocking content-safety
  pass on append, a min-trust gate, per-user row caps, daily rate limits,
  moderator soft-hide — exist because the payload is public user-generated text.
- **There are no signals.** Every `SHARED_*` message the host sends is a reply. A
  viewer cannot see another viewer's vote without re-reading, so a vote count is
  stale the moment it renders, and a `watchShared*` would be a polling loop
  wearing a `watch` name.

### `QUERY_APP_WORKFLOWS` / `CANCEL_APP_WORKFLOW`

The host's own app-scoped orchestrator bridge, which `orchestration` replaces.
`CANCEL_APP_WORKFLOW` is a straight duplicate of `ORCHESTRATION_CANCEL_WORKFLOW`.
The listing was not, so it moved onto this package's protocol as
`ORCHESTRATION_LIST_WORKFLOWS` rather than being lost — the host scopes it to the
calling app, exactly as it already does for the older message.

Carrying both would have meant two workflow types in one package, and the older
one is lossy: `AppWorkflow` is a projection with an `images` array, so it assumes
every generation produces images. `orchestration` carries the orchestrator's own
`Workflow`, where outputs are whatever the steps really produced.

**Cost:** `orchestration` speaks a protocol no host handler implements, so
listing past generations does not work today, where the older message did.

### Upload — `OPEN_IMAGE_UPLOAD`, `IMAGE_SCAN_RESOLVED`

The site takes images, video and soon audio. **This uploader does not.** Both
host modals hard-code `accept="image/png,image/jpeg,image/webp"` as a literal
string rather than the platform's own `IMAGE_MIME_TYPE`, so they did not even
inherit the video support civitai already defines beside it
(`VIDEO_MIME_TYPE` = mp4, webm).

Not ported because civitai already has a media upload wizard. A blocks-only
modal that accepts three image formats is a second, narrower uploader to
maintain, and anything built on it would need renaming the day it widens —
`uploadImage`, its `PickedImage` union and the async-scan handshake are all
image-shaped.

**Revisit when** the host routes block uploads through its own wizard. At that
point the bridge message should carry media, not images.

Still ported: `getImages`, `saveImage`, `publishOutputs` and `createPost`. Those
read or publish images that already exist, which is a different question from how
one gets created.

### Pickers — `OPEN_RESOURCE_PICKER`, `OPEN_CHECKPOINT_PICKER`, `SET_USER_CHECKPOINT`

The host side of this is good: both messages open civitai's own
`ResourceSelectModal` **unmodified**, in host chrome. The block never receives
the catalog, the search API or a list — only the one resource the viewer
physically picked. Nothing bespoke was built for blocks.

Four findings, all pointing at a design pass rather than a port:

**The picked resource cannot reach our submit path.** A workflow template
addresses resources by AIR — `model` is "the AIR of the checkpoint model", and
`additionalNetworks` is keyed by "the AIR of the network". `RESOURCE_PICKER_RESULT`
returns a `versionId`, with no way to convert. `@civitai/blocks-react` never hits
this because it posts `body.modelVersionId` to the *host*, which resolves the AIR
server-side; `orchestration` deliberately bypasses that by carrying the
orchestrator's own `WorkflowTemplate`. The picker and the submit path came from
two different worlds and do not join up.

**Adopting the orchestrator's own `ResourceInfo` is not the fix.** That type is a
worker descriptor — `air`, `size`, `hashes`, `downloadUrls` — and handing a block
download URLs for a gated model would be a disclosure. It also lacks the names and
trigger words a picker exists to provide. What is needed is the **identifier**:
`air` alongside `versionId`, which is additive and back-compatible.

**`OPEN_CHECKPOINT_PICKER` is superseded in design but not in deployment.** Both
messages open the same modal, and the host's own comment says the resource picker
"generalizes" the checkpoint one. But the wide picker is wired **page-only** — on
a model slot the narrow one is all there is, so it cannot simply be dropped in
favour of the general one.

**`SET_USER_CHECKPOINT` is inert on a page.** It persists to `block_user_settings`
for a model-bound install (what later feeds `BLOCK_INIT.context.checkpoint`), and
`updateUserSettings` hard-requires a `modelId` the page token does not carry — so
the page host answers `ok: false` by design. A plain `setCheckpoint(versionId)`
would give no hint that it does nothing on half the surfaces.

**Revisit when** `RESOURCE_PICKER_RESULT` carries the AIR. At that point the
picker is worth exposing, and the checkpoint/resource split is worth collapsing.

### Publishing and reading images

`SAVE_IMAGE` is carried, as `media.save()`. The rest is not.

**No image ids anywhere.** Every source of one inside this package is gone or
unported — the picker, the upload, and the two publish paths below. So
`GET_IMAGES_BY_IDS` is not carried, and `media.download()` takes a `url` only,
although the wire accepts `imageId` too. An app can persist ids it obtained
elsewhere and re-read them, but that is a use case waiting for a surface.

Worth knowing for when it comes back: the `imageId` variant of `SAVE_IMAGE` is
not merely a convenience. It resolves through the same gated per-viewer read that
backs `GET_IMAGES_BY_IDS`, so a withheld image cannot be coerced into a
download — a permission check the block cannot perform itself.

**Publishing has two paths, and the newer one says so.** The router's own comment
on the post audit row reads: *"NET-NEW ON THIS FAMILY. `publishGenerationOutputs`
writes NO such row (its omission is a real gap, not a precedent)"* — so a publish
through the older message leaves nothing in the viewer's Activity feed to say an
app posted on their behalf. `CREATE_POST_FROM_APP` is the considered design and
`PUBLISH_GENERATION_OUTPUTS` is what came before it.

**Both address outputs positionally.** `imageIndexes` indexes into a workflow's
images, absent meaning "every available output". That assumes an image-producing
workflow and stable ordering — the same assumption behind the `imageUrls` shape
this package already refused.

**Revisit when** publishing is one design rather than two.

### `GET_DAILY_COMPENSATION`, and a correction

Per-modelVersion creator earnings, Buzz plus cash in pennies. **Despite the name
it returns the whole month** containing the date, bucketed by day —
`getDailyCompensationRewardByUser` uses `startOf('month')` / `endOf('month')`.
This package briefly shipped it documented as one day's earnings, which was
wrong; noted here so the misreading is not repeated.


## Open question: the bridge or the REST API

A block has two ways to reach civitai. The bridge, where the host decides per
message whether to serve it, rate-limits per block instance and audits it. And
`GET https://civitai.com/api/v1/blocks/*` with `token.raw` as a bearer, where a
block can call anything its scopes allow, forever.

**`REQUEST_TOKEN` / `refreshToken()` exists only to serve the second path** —
mint a fresh token after a 401 and retry. It is not exposed here for that
reason: with everything else host-mediated, nothing in this package needs it.

### Seven capabilities exist only over REST

Deciding the question means deciding these, because today a block that wants any
of them has to hold a bearer token:

| Endpoint | What it gives a block |
|---|---|
| `GET /models` | Catalog model search, maturity-clamped |
| `GET /images` | Catalog image search |
| `GET /collections`, `/collections/{id}` | Collection discovery — `mode=public\|mine`, search, sort, paging |
| `GET`/`POST /tools` | Tool definitions for a chat model, and executing one |
| `POST /tip`, `GET /tip-allowance` | Send a Buzz tip; read the remaining daily cap |
| `GET /generation-resources?ids=` | Rehydrate a saved set of picked resources — the picker returns one at a time |
| `GET /shared-storage/top`, `POST /shared-storage/increment` | App-defined counters |

`GET /me` and `POST /collections/{id}/follow` also exist but duplicate bridge
messages. `submissions`, `submit-version`, `withdraw` and `dev-token` are CLI and
harness surface, authenticated by a developer token — they belong nowhere near a
block.

**Tipping is the one to look at first.** `<civitai-tip-button>` is planned for
`@civitai/elements` and has no bridge message at all, so it inherits the
direct-fetch path unless the bridge grows one.

### A third answer, not scheduled

If a token is ever exposed again, it should be minted **by grant** — the app asks
for one for a purpose, the host decides, and the SDK owns its lifetime so no app
code ever refreshes. `requestConsent` is already the shape of that ask; it just
widens the block's own token instead of returning a separate one. This is the
version where the two paths stop competing, because minting becomes the gate
rather than the bridge. Recorded as direction, not planned work.

### The stronger version of the argument

The token is already in the block's hands — `BLOCK_INIT` ships `token.raw`, and
it is on the snapshot. So direct-fetch discloses nothing new; the disclosure
happened at init.

Which means: **if everything went over the bridge, `raw` would not need to be in
`BLOCK_INIT` at all.** A block would get scopes, expiry and budget — enough to
gate its own UI — without the JWT. That is a host-side change and breaking for
deployed blocks, so it is not ours to take, but it is the difference between two
overlapping paths and one.

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
