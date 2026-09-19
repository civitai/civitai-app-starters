---
'@civitai/blocks-client': minor
---

Add `@civitai/blocks-client` — the host bridge for apps that are not React.

The postMessage transport and its origin validation previously existed only
inside `@civitai/blocks-react`, so a vanilla, Svelte or Vue app had to take a
React dependency to reach them. This package stands alone: no peer at all,
and `@civitai/orchestration-client` as its one dependency. `@civitai/blocks-react` is unchanged.

The API is grouped by domain and reads `civitai.buzz.getBalance()`. Each call
takes an `AbortSignal`, carries a per-message deadline, and throws `BridgeError`
with a `code` of `host`, `timeout` or `malformed`. Reply envelopes are unwrapped
by a single protocol table, so a call resolves to the value it is defined to
return rather than to `{ result?, error? }`.

`getTransport()` caches on a `Symbol.for` global so two bundle copies share one
transport rather than each racing a second `BLOCK_READY`, and falls back to the
canonical Civitai parent origins when no build-time env supplies them.

`orchestration` covers generation: `estimateWorkflow`, `submitWorkflow`,
`getWorkflow`, `watchWorkflow`, `runWorkflow` and `cancelWorkflow`. It carries
`@civitai/orchestration-client`'s own `WorkflowTemplate` and `Workflow` rather
than a shape of its own, so steps, statuses and outputs stay whatever the
orchestrator says they are and a step it gains needs no release here. The one
addition is `maxBuzz`, a hard spend ceiling.

`runWorkflow()` submits and settles in one call, resolving with the finished
workflow however it finished; `watchWorkflow()` is an async generator over a
running workflow's states for callers that render progress. Either way no app
owns a polling loop: the held read, the retry-on-blip and the terminal-state set
live here. `watchWorkflow` holds each read open and then reads
again immediately, so images finishing together surface as they land; it sets no
cadence of its own and backs off only after a failed read. A failed run resolves rather than throwing — `status` says which —
so `BridgeError` is left meaning a request that was refused.

`buzz` is the first domain on a protocol this package owns rather than inherits:
a uniform `{ requestId, result?, error? }` envelope, reply names derived as
`<REQUEST>_RESULT`, and failures carrying a code (`forbidden`, `insufficient`,
`unavailable`, …) instead of free text. It exposes `getAccounts`,
`watchAccounts`, `listTransactions` and `requestPurchase`.

`watchAccounts()` is a shared live value kept current by the host's
`BUZZ_ACCOUNTS_CHANGED` push, so a tip arriving or another app spending updates
every component without any of them polling. It is an `EventTarget` and
async-iterable, so it drives `useSyncExternalStore`, a Lit controller or a
`for await` loop unadapted. `listTransactions` is an async generator
that pages the ledger as you read it, so the cursor never reaches a caller —
which matters, because the host returns that cursor as a `Date` while declaring
it a `string`. Each row's `date` is normalised to the ISO string its type
declares for the same reason.

`storage` is the per-viewer key/value store, and the one domain that needs
nothing new from the host: it carries the existing `APP_STORAGE_*` messages
unchanged, so `get`, `set`, `remove`, `list` and `getQuota` work against
production today. Those replies put their fields straight in the payload and
report failure as the server's own sentence, so the transport converts that
framing into this one — `fromLegacyReply`, classifying the host's text into the
same `code` everything else here throws.

There is deliberately no `localStorage` fallback: the host
grants `allow-same-origin` only to verified apps, so for everyone else reading
that property throws rather than returning empty — and silently degrading a
signed-in viewer's saved work to one device is worse than an error.

`createFakeTransport()` gains `handle(type, fn)`: a standing answer computed from
the request, rather than a queued one consumed per call. A test says what the
host does — `({ key }) => ({ value: store.get(key) ?? null })` — instead of
lining up one reply per expected call. The one-shot `reply`/`fail` remain and are
taken first, so a sequence or a single exception to the rule still reads well.

`viewer` is the other half of the failures this package already throws:
`getViewer()` for the audited self-read, `requestSignIn()` for an anonymous one,
and `requestConsent(scopes)` for a token missing a scope. The last is awaitable
even though the host message is fire-and-forget — it resolves when the re-minted
token carries the scopes and rejects `forbidden` on `CONSENT_UNAVAILABLE`, so a
block retries after an `await` instead of wiring a listener to a push that
carries no correlation id. It also exposed that reply names are not derivable
across the older messages — `GET_VIEWER` answers `VIEWER_RESULT` — so the ledger
names each reply rather than deriving it.

The handshake is owned here too, in `core/handshake.ts` — the init payload, the
four messages the transport acts on, and the fragment parsing — so
`@civitai/app-sdk` is no longer a dependency of any kind and the protocol can
move without waiting on another package's release. `blockId` and `appId` are
not declared: the host must keep sending them, but they are build-time identity
a block reads from its own manifest.

A parity guard replaces the compiler that owning the handshake gave up: every
message this package sends is checked against a committed snapshot of the host's
own handler inventory, so a rename on either side fails a test instead of
hanging a block with no error and no network call. The snapshot also records
which messages the host does not answer yet — the `BUZZ_*` and `ORCHESTRATION_*`
set — and fails the day it does, which is the prompt to delete the entry.

`media` and `host` complete the surface: 20 of the host's 46 messages. `BREAKING.md` lists what is left out and why — the shared datastore, a
creator-earnings report, wildcard-pack import, collection follow, an analytics
message the host drops on arrival, and the app-scoped workflow bridge that
`orchestration` supersedes. Its listing moved onto this package's own protocol
as `ORCHESTRATION_LIST_WORKFLOWS` rather than being lost. A closed picker or dialog resolves `null` rather than throwing —
abandoning is a decision — and a gated image comes back `hidden` rather than
missing, so a gallery keeps its shape. `host` covers the frame itself: resize,
navigate, error reporting, a token refresh the block asks for rather than waits
for, and a visibility signal so a block can stand down while the page is hidden.

One of these replies showed the host is not consistent about framing: some nest
their value under `result` and others put its fields straight in the payload. The
legacy converter now reads both, which leaves the strict envelope check intact
for this package's own protocol.

Every `list*` generator now stops after 100 items unless told otherwise:
`limit` is a total rather than a page size, `Infinity` reads to the end, and the
last request asks only for what is still wanted. A generator that walks to the
end by default makes reading someone's entire history the easy mistake, and the
cap is ours — it holds even if the host serves more than it was asked for.

`REQUEST_TOKEN` is deliberately not exposed. Its only use is refreshing a bearer
after a 401 on the direct-fetch path — `GET /api/v1/blocks/*` with `token.raw` —
and that path competes with the bridge rather than complementing it. `BREAKING.md`
records the seven capabilities that exist only over REST, so the choice between
the two can be made on evidence.

Parameter types follow one rule: a read that filters or pages takes a `query`
(`BuzzLedgerQuery`, `StorageQuery`, `WorkflowQuery`); an action takes a `request`
(`UploadRequest`, `SaveImageRequest`, `CreatePostRequest`). Calling an upload a
query read as though it were a search.

Image upload is not carried. The host's block-upload modals hard-code
`accept="image/png,image/jpeg,image/webp"` while the site takes images, video and
soon audio — and civitai already has a media upload wizard, so a blocks-only
uploader would be a second, narrower one to maintain. Reading and publishing
images that already exist is still here; only creating one is not.

The resource pickers are not carried either. A workflow template addresses
resources by AIR — `model` is the checkpoint's AIR and `additionalNetworks` is
keyed by the network's — while `RESOURCE_PICKER_RESULT` returns a `versionId`
with no way to convert, so a picked resource cannot be fed into this package's
own submit path. `BREAKING.md` has the rest: the checkpoint picker is superseded
in design but is still the only one wired on a model slot, and
`SET_USER_CHECKPOINT` is inert on a page by construction.

`media` is one function: `download()`, the host-chrome download a sandboxed block
cannot trigger itself — named for what it does, since "save" reads as adding to a
collection, which is a different thing entirely. It takes a url and takes images and video alike — the host's own
download bridge already maps mp4, webm and mov, so only the message name says
"image". The wire's `imageId` variant is not exposed, because nothing in this
package produces an image id.
Reading images by id and the two publish paths are not carried; `BREAKING.md`
records that nothing in this package produces the ids they take, and that
civitai's own router calls `publishGenerationOutputs`' missing audit row "a real
gap, not a precedent".
