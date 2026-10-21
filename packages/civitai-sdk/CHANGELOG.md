# @civitai/sdk

## 0.19.0

### Minor Changes

- 994b502: **BREAKING (0.x minor): App Blocks `kind: 'training'` now trains on images the viewer uploads, not on a server-prepared dataset** — the SDK half of civitai/civitai#6461.

  The training run is unchanged; how its dataset is named is not:

  - `WorkflowBodyTraining.items: BlockTrainingDatasetItem[]` (`{ air, caption }`, 1–50, one blob at most once) **replaces** `datasetId`. `BLOCK_TRAINING_CAPTION_MAX_CHARS` is now 8,192.
  - Upload the images with `useImageUpload({ purpose: 'trainingData' }).open()` (`OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`). The viewer picks up to 50 images in a Civitai modal; `open()` resolves with `[{ url, air }]` (`BlockTrainingDataImage[]`), or `null` on cancel. Pair each `air` with a caption.
  - `RUN_TRAINING` gains the host code `training data not uploaded here`: the host refuses, before any dialog, a quote naming a blob it did not upload for this block (e.g. after a reload). `RunTrainingError.trainingDataNotUploaded` flags it; no run, nothing charged — upload again and estimate again.

  Removed, with no replacement beyond the above:

  - `@civitai/blocks-react`: `usePrepareTrainingDataset`, `UsePrepareTrainingDataset`, `PrepareTrainingDatasetError`, `PREPARE_TRAINING_DATASET_ERROR_CODES`, `isPrepareTrainingDatasetErrorCode`, and the `BlockPrepareTrainingDatasetHostError` / `BlockTrainingDatasetResult` / `BlockTrainingRejectionReason` re-exports. Mock host: the `trainingDatasetRejected` and `trainingDatasetError` options are gone; `cannedTrainingDataUpload` (the images an upload returns) and `trainingDataNotUploadedHere` (refuse every run as a host that forgot its uploads) are new, and the mock now checks a run's whole body against its quote.
  - `@civitai/app-sdk/blocks`: the `PREPARE_TRAINING_DATASET` / `TRAINING_DATASET_RESULT` message pair, `BlockTrainingDatasetResult`, `BlockTrainingRejectionReason` and `BlockPrepareTrainingDatasetHostError`. New: the `'trainingData'` upload purpose, `BlockTrainingDataImage`, `BlockTrainingDataUploadResult` (the multi-image `IMAGE_UPLOAD_RESULT.selected` shape), and `BlockRunTrainingHostError` member `'training data not uploaded here'`.
  - `@civitai/sdk`: the copied `WorkflowBodyTraining` follows (`items`, not `datasetId`), and `BlockTrainingDatasetItem` is exported from the package root. The host reply ledger is regenerated from civitai/civitai#6461.

  Training from apps stays behind the host flag `app-blocks-training-kind` (off by default), page apps only.

## 0.18.0

### Minor Changes

- 6196655: A dev-tunnel preview's document store is local to the tab (civitai/civitai-app-starters#710).

  `@civitai/sdk`: when the host marks the frame `storageMode: 'local-preview'` in `BLOCK_INIT`, `initialize()` serves `app.storage.collection(name)` and `app.storage.info()` from an in-memory store (`createFakeStorage`, loaded with a dynamic `import()`) that enforces the LOCAL manifest's declarations, and sends no request to `blocks/storage/*`. The manifest reaches the SDK only from `blockManifestPlugin()` on the Vite dev server; without it, every document-store call rejects `local_preview_no_manifest` (404, not retryable, nothing sent). New: `app.storage.mode` (`'remote' | 'local-preview'`), the `StorageMode` type, and the local error codes `local_preview_no_manifest`, `local_preview_invalid_manifest` and `local_preview_unavailable` (all 404, not retryable). Model-version ownership (`ownedModelVersions`) is not checked locally; the server checks it. The mode switches only on the host's exact signal, never on token scopes. Without it, a real route's `insufficient_scope` now carries a hint after the server's message (declare `apps:storage`; granted once approved; previews are local when the host marks them). The deprecated key/value stores and `@civitai/blocks-react`'s storage hooks are unchanged and keep the real routes.

  `@civitai/app-sdk`: `blockManifestPlugin()` exposes the manifest's `scopes` and `storage` to `@civitai/sdk` on the dev server only (a `<script>` at the end of `index.html`'s `<head>`; never in a build). `BlockInitPayload` gains the optional `storageMode?: 'local-preview'`.

## 0.17.1

### Patch Changes

- 924d710: Docs: `WorkflowBodyPassThroughStep.input` (copied from `@civitai/app-sdk`) says the block host refuses inline media in a step input — upload the file and pass its hosted `url` instead.
- ab5bf92: **`useMediaUpload()` uploads an image, video or audio file as a generation input, and returns a `url` to pass into a workflow step.** The host refuses data URIs and inline base64 in step inputs, so this is the way to get media into a step. `const { open, upload } = useMediaUpload()`: `open({ kind })` opens the host's file picker and resolves with the upload or `null`; `upload({ kind, bytes, mimeType? })` uploads bytes the app made in the tab (a canvas, a crop, a `MediaRecorder` recording) with no picker.

  - **Release hold satisfied:** civitai/civitai#6149, the host change that answers `OPEN_MEDIA_UPLOAD`, is merged and deployed to production. A host that predates it does not answer the message at all, so `open` and `upload` would wait out the human-interaction timeout (10 minutes) and then reject with `RequestTimeoutError`.
  - **What each kind accepts**, by the file's content: `'image'` PNG, JPEG or WebP (the host resizes it to 64–2048 px per side and re-encodes it as JPEG, so `mimeType` is always `image/jpeg`); `'video'` MP4 or WebM; `'audio'` MP3, WAV or WebM. The result is `{ url, kind, mimeType, sizeBytes, width?, height?, durationMs? }`: `width` and `height` are set for image and video and absent for audio, and `durationMs` is set for video and audio when the browser reports a duration.
  - **Limits:** 24 MB per image (the host decodes an image in full before resizing it) and 64 MB per video or audio file; `upload` refuses a larger buffer before sending, with the host's `file exceeds the 24 MB image upload limit` or `file exceeds the 64 MB upload limit`. `upload` is limited to 8 uploads and 128 MB per 60 seconds per page; past that it rejects with `busy`. `open` is not rate-limited.
  - **`null` and refusals:** `open` resolves `null` when nothing was uploaded (the viewer closed the picker, or the app is in review mode or not ready). `upload` never resolves without a file: a declined upload rejects with `the host did not upload the media (the app is in review mode or not ready)`. Every refusal rejects with the host's message, including `no block token` (bytes mode, when the host holds no token), `media upload failed — please try again` and `this video was refused by the upload service` / `this audio was refused by the upload service`; a non-page surface answers `unsupported on this host`.
  - **Refused before sending,** with the host's own strings: an unknown `kind`, a `bytes` that is not a non-empty `ArrayBuffer`, a non-string `mimeType`, and a buffer over the kind's cap.
  - `useImageUpload().open({ purpose: 'generationSource' })` is unchanged and still valid for images.
  - New exports from `@civitai/blocks-react`: `useMediaUpload` and the types `UseMediaUpload`, `MediaUploadOpenOptions` and `MediaUploadBytesOptions`; `@civitai/blocks-react/testing` adds the type `MockMediaUploads`.
  - `@civitai/app-sdk`: the message union gains `OPEN_MEDIA_UPLOAD { requestId, kind, purpose: 'generationSource', bytes?, mimeType? }` and `MEDIA_UPLOAD_RESULT { requestId, selected?, error? }`, plus the types `BlockMediaKind` and `BlockMediaUploadInfo` on `./blocks`. `OPEN_MEDIA_UPLOAD` is added to `BLOCK_TO_PARENT_MESSAGE_TYPES`. Use this `@civitai/app-sdk` release or later with this `@civitai/blocks-react` release. `OPEN_IMAGE_UPLOAD` and `IMAGE_UPLOAD_RESULT` are unchanged.
  - The reply validator accepts `MEDIA_UPLOAD_RESULT` with a string `error`, a bare reply, or a `selected` with a non-empty `url`, a known `kind`, a string `mimeType`, a whole `sizeBytes` ≥ 0, positive whole `width` and `height` (required for image and video, absent for audio) and a finite `durationMs` ≥ 0 when present. Anything else is dropped.
  - **Mock host (`createMockHost` / `Harness`):** answers at once. New option `cannedMediaUploads` sets each kind's upload (a kind left out answers a built-in default; `null` dismisses that kind's picker). Bytes uploads run the host's checks in the host's order, including the content sniff and the rate window. The mock cannot decode media, so it never produces the host's decode-time refusals; `mediaUploadError` forces one. `mediaUploadError: 'no block token'` is placed where the host checks it: a bytes upload is refused before the cap and the window, and not counted. Both are live-tunable through `setScenario`. A model-slot `context` answers `unsupported on this host`.
  - **`dev:live`:** refuses the request, because the upload needs the viewer's signed-in session. Both calls reject with `media upload is not supported in dev:live — use dev:mock`.
  - **Inline-media docs point at `useMediaUpload`:** `WorkflowBodyPassThroughStep.input` in `@civitai/app-sdk` (and its copy in `@civitai/sdk`) and the `@civitai/blocks-react` README's step-input rules now say to upload an image, video or audio with `useMediaUpload()` (an image also works with `useImageUpload({ purpose: 'generationSource' })` or `useImagePicker()`) and pass the returned `url`. The mock host's inline-media refusal already names `useMediaUpload`, matching the host's message.

## 0.17.0

### Minor Changes

- ae33f6c: **App reactions: a block can read and set the viewer's reactions on images it was served (scope `social:react:self`, civitai/civitai#6144).** A reaction made this way is a reaction on civitai.com: it pays the reactor and the image owner as the site's own button does, moves rankings, notifies, and draws on the same per-viewer quota. Apps may set `Like`, `Heart`, `Laugh` and `Cry`, never `Dislike`. Image is the only entity type.

  - **`@civitai/app-sdk`.** The `SET_ENTITY_REACTION` → `ENTITY_REACTION_RESULT` and `GET_ENTITY_REACTIONS` → `ENTITY_REACTIONS_RESULT` messages, as the host implements them: a write takes `{ entityType, entityId, reaction, reacted, ticket? }` (a desired state, not a toggle) and answers `{ entityType, entityId, reaction, reacted, changed, counts, viewerReactions, statsUnknown }`; a read takes `{ entityType, ids, tickets? }` (at most 100 ids) and answers `{ entityType, byId, unavailable }`, where `byId` is keyed by the id as a string and an id without a valid ticket is listed in `unavailable` instead of answered. Every failure is one of the closed `ENTITY_REACTION_ERROR_CODES`: `invalid-request`, `sign-in-required`, `review-mode`, `not-ready`, `needs-consent`, `entity-unavailable`, `rate-limited`. New exports from `./blocks`: `APP_REACTIONS`, `STORED_REACTIONS`, `REACTION_ENTITY_TYPES`, `REACTION_READ_MAX_IDS`, `REACT_TICKET_MAX_LENGTH`, `ENTITY_REACTION_ERROR_CODES`, `isEntityReactionErrorCode`, `isAppReaction`, and the types `BlockAppReaction`, `BlockStoredReaction`, `BlockReactionEntityType`, `BlockEntityReactionErrorCode`, `BlockReactionCounts`, `BlockEntityReactionState`, `BlockEntityReactionResult`, `BlockEntityReactionsResult`. `BLOCK_TO_PARENT_MESSAGE_TYPES` lists both requests.
  - **`@civitai/blocks-react`.** `useReactions(entityType, ids, { tickets })` returns `{ byId, unavailable, loading, error, toggle, pending }`. It reads `ids` in chunks of 100 on mount, then reads only the images that need it (an id added to `ids`, or one whose ticket changed), because the host counts every read against the block instance's shared catalog rate limit. An answer is never applied over a write on the same image that started after the read was sent, and an older answer never overwrites a newer one. `toggle(id, reaction, reacted)` moves `byId[id]` at once, puts it back on failure, adopts the host's `viewerReactions` on success, and rejects with a `ReactionError` (`.code`, `.signInRequired`, `.needsConsent`, `.timedOut`, `.busy`). A `toggle` on an image without a ticket, or on one whose same reaction is already in flight, is refused without sending anything: the server checks the ticket after its rate limit, so sending it would spend one of the viewer's reactions. A busy refusal rejects the call without setting the hook's `error`. After a failed write the image is read again if the write timed out (it may have landed) or the image has no state. Also exported: `ReactionError`, `REACTIONS`, `REACTION_ERROR_CODES`, `isReactionErrorCode`, and the reaction types from `@civitai/app-sdk/blocks`. `createMockHost` and `<Harness>` answer both messages: seed images with `reactionStates`, force a code with `reactionError` (both live-tunable with `setScenario`; a forced `review-mode` or `not-ready` is answered before the sign-in, payload and scope checks, as the host's own gate orders them), and declare `social:react:self` in `declaredScopes` or every call answers `needs-consent`, as the real host does for an ungranted scope. The mock accepts any well-formed ticket, since a real one is an HMAC only the server can check. `@civitai/blocks-react/testing` exports the `MockReactionSeed` type. The live dev host refuses both with `entity-unavailable`: the server's reaction procedures need the viewer's civitai.com session.
  - **`@civitai/components`.** `<civitai-reaction>` takes a `reaction` property (a string such as `Like`, reflected as an attribute). When it is non-empty it is carried as-is in the `react` event's `detail.reaction` and is the accessible name when there is no `label`; the element does not check it against any list. `emoji` stays display only. Without a `reaction`, or with an empty one, the event detail is exactly `{ emoji, reacted, count }`, as before.
  - **`@civitai/sdk`.** The host snapshot is refreshed from civitai `cd79a91fe4`, so `request()` settles `SET_ENTITY_REACTION`, `GET_ENTITY_REACTIONS` and `OPEN_MEDIA_UPLOAD` instead of refusing them as unknown, and `SCOPES` names `social:react:self`.

## 0.16.0

### Minor Changes

- 25ad9f9: **A shared storage collection can require that the model versions it stores are the writer's own (`ownedModelVersions`, civitai/civitai#6132).**

  - **`@civitai/app-sdk`.** The vendored manifest schema is re-vendored from https://civitai.com/schemas/app-block/v1.json, and `BlockStorageSharedCollectionDeclaration` gains `ownedModelVersions?: string[]`: 1 to 4 distinct pointers into a document's `data` (each 1 to 4 segments of `/` then a letter or `_` and up to 63 letters, digits or `_`, such as `/workflow/modelVersionId`). The canonical allows it only on a shared collection with `write: "own"`, and `defineBlock` enforces that from the schema. On every create and update civitai.com refuses a declared field holding anything but a model version the writer owns: 403 `resource_not_owned`, before moderation and before any write budget. An absent field is allowed. The same re-vendor brings the canonical's new `social:react:self` scope (app reactions, civitai/civitai#6144: sensitive and consent-gated), now `BLOCK_SCOPES.SOCIAL_REACT_SELF`. This package has no reaction helper yet. Additive for authors: nothing that validated before is rejected.
  - **`@civitai/sdk`.** `StorageErrorCode` names `resource_not_owned`. `createFakeStorage` enforces a collection's `ownedModelVersions` rule in the server's order: before the trust gate, the write budget and moderation, with every value checked before any ownership. The fake has no model versions of its own, so `FakeStorageViewer.modelVersions` lists the ids a viewer owns. It defaults to none, so every id is refused, as the server refuses one that is not the writer's. A declaration the platform would refuse (on a private or `write: "none"` collection, or a malformed pointer list) makes `createFakeStorage` throw.

## 0.15.0

### Minor Changes

- 2e7f458: Add `app.subListings`, a typed client for the App Store sub-listing routes (`/api/v1/blocks/sub-listings/{upsert,withdraw,mine}`), so an app no longer hand-rolls `app.site.post('blocks/sub-listings/upsert', …)`. `upsert(input)` sends only the six fields the server's strict body accepts (`itemKey`, `title`, `subPath`, `tagline`, `imageId`, `contentRating`) and leaves out an optional that is `null` or `undefined` — every call replaces the whole item, so a left-out optional is cleared; `withdraw(itemKey)` resolves `{ ok, withdrawn }`; `mine()` resolves `{ items }` with `updatedAt` revived as a `Date`. A refusal carrying a `code` rejects as the new `SubListingError`, an `ApiError` subclass whose `code` is typed as `SubListingErrorCode`; a refusal without one stays a plain `ApiError`, and a malformed reply rejects with a `CivitaiError`. New exports: `SubListingError` and the types `SubListingsClient`, `SubListingUpsertInput`, `SubListingUpsertResult`, `SubListingWithdrawResult`, `MySubListing`, `SubListingStatus`, `SubListingContentRating`, `SubListingErrorCode`, `SubListingCallOptions`. No scope or manifest change: the routes still need `apps:store:items:write`, which is never minted for dev-token, dev-tunnel or review sessions.

## 0.14.1

### Patch Changes

- d00a806: Docs only. The legacy shared store's minimum-trust gate no longer lists a paid tier, which the server does not check; it lists account age, completed onboarding, a verified email or linked OAuth account, and not being banned or muted (README, `BREAKING.md`, and the `SharedStorageClient` doc comment). The `app.sharedStorage.list` example no longer filters on `prefix: 'deck:'`: `append` mints every key as a ULID, so a prefix you choose matches none of the rows it creates. The README and the `SharedListQuery.prefix` doc comment now say so.

## 0.14.0

### Minor Changes

- 4a0c705: Add the App Blocks document store client: `app.storage.collection<T>(name)` with
  `get`, `getMany`, `put` (with `ifVersion`), `create`, `delete` (with `ifVersion`),
  `list` (one declared-index `where`, `sort`, `author: 'me'`, `markedBy: 'me'` +
  `mark`, `keyPrefix`, `limit`, `cursor`), `increment`, `mark` and `unmark`, plus
  `app.storage.info()` and a `StorageError` carrying the server's `code`, `status`,
  `details` and `retryAfter`, over `/api/v1/blocks/storage/…`.

  `@civitai/sdk/testing` gains `createFakeStorage({ manifest })`, an in-memory store
  at the client's `Http` seam that enforces the server's storage rules and passes
  the platform's storage contract. Its rate limits are opt-in
  (`enforceRateLimits: true`), so an app's own tests are not throttled. As the
  server does, it refuses withdrawing a `report` mark (`unmark(key, 'report')`) with
  `invalid_request`, before sign-in or any rate budget.

  A `401` whose body's `code` is `sign_in_required` is no longer retried with a
  re-minted token: it is about the viewer, not the token, so the retry only cost a
  second request. Every other `401` is still retried once.

  The legacy key/value methods on `app.storage` (`get`, `set`, `delete`, `list`,
  `getQuota`) and `app.sharedStorage` are now `@deprecated`, with no change in
  behaviour; they keep working until apps have moved to collections.

## 0.13.1

### Patch Changes

- a53587e: **The manifest gains an optional `storage` (document-store collections) declaration, typed and validated.** `storage.collections` maps a collection name to a declaration discriminated on `visibility`: a `private` collection (a key space per viewer) or a `shared` one (one key space for the app, which must declare `write`: `own`, `none`, or the reserved `anyone` / `owner`). A collection may also declare `kind`, `indexes` (field path → `string` | `number` | `boolean` | `time`), and on a shared collection `counters`, `marks` and `showAuthor`.

  - **Types.** `BlockManifestV1.storage`, plus the exported `BlockStorageDeclaration`, `BlockStorageCollectionDeclaration`, `BlockStoragePrivateCollectionDeclaration`, `BlockStorageSharedCollectionDeclaration`, `BlockStorageIndexes` and `BlockStorageIndexType` from `@civitai/app-sdk/blocks` and `@civitai/app-sdk/manifest`.
  - **Scopes.** `BLOCK_SCOPES.APPS_STORAGE` (`apps:storage`) and `BLOCK_SCOPES.APPS_STORAGE_PUBLISH` (`apps:storage:publish`). `BLOCK_SCOPE_PATTERN` now accepts 2 segments as well as 3 or 4, because `apps:storage` has two.
  - **Schema.** Re-vendors the canonical App Block manifest schema from https://civitai.com/schemas/app-block/v1.json, which now declares `storage` and the two scopes. `defineBlock` validates against it: 1 to 16 collections named `^[a-z][a-z0-9_]{0,31}$`; a shared collection must declare `write` and a private one carries none of the shared-only fields; a `write: "none"` collection declares at least one counter or mark; at most 8 counters and 8 marks, never `report`; at most 4 indexes, never named `key`, `createdAt` or `updatedAt`; no other keys at any level.
  - 🔴 **This is a tightening, which is why the bump is `minor`.** The schema root allows undeclared keys, so until now a top-level `storage` key of any shape passed `defineBlock` unvalidated. A manifest that already carries a `storage` key that does not match the declaration above now fails.
  - **Not checked locally:** the scope couplings (any collection needs `apps:storage`; a viewer-written shared collection needs `apps:storage:publish`) and the reserved features (`kind: "log"`, `ttlSeconds`, `dailyWritesPerAuthor`, `write: "anyone"` / `"owner"`), which validate here and are refused at submit. See `KNOWN_GAPS['storage-server-only-rules']`. The platform's manifest validator remains authoritative.
  - This types the declaration only. It adds no storage client.
  - **Docs.** The pass-through step's `maxBuzz` docs no longer say the per-call budget is "capped at 1000". The budget has a platform default and a separate platform cap; the docs now link the pinned limits table at https://developer.civitai.com/apps/guide/text-to-image.md#limits-table. `@civitai/sdk` carries a generated copy of that doc comment, which is why it gets a `patch` here.

## 0.13.0

### Minor Changes

- 04e067d: `getTransport().request(type)` now knows the reply name and shape of every request type
  the host answered when this version was built, and refuses at once a type the host never
  answered.

  - The reply ledger is generated from the host's inventory (`snapshots/host-messages.json`,
    now carrying each request's reply name, framing and success keys) and covers all 43
    host request types instead of 6. `request('GET_VIEWER')` resolves `{ viewer }` rather
    than hanging; the `APP_STORAGE_*` and `SHARED_*` replies resolve with their fields
    rather than rejecting `malformed` on success; `CANCEL_APP_WORKFLOW`'s failure keeps
    the host's message.
  - A type the host does not answer rejects immediately with a `BridgeError` of code
    `invalid` instead of waiting forever. A fire-and-forget message says to use `notify()`,
    and where BREAKING.md names a replacement the message names it (e.g. `GET_VIEWER` →
    `app.site.get('blocks/me')`). The list of types is fixed at publish time, so a type
    the host adds later is refused too, and the message names the SDK version and host
    snapshot and says to upgrade.
  - Knowing the reply is not a promise that one comes: `request()` still has no deadline
    of its own, and the host stays silent in some cases. `REQUEST_TOKEN`
    (`getToken({ fresh: true })`) gets no reply while the host holds no token,
    `GET_WILDCARD_PACK` gets none in a model-page slot (only full-page app hosts answer
    it), and the host drops rate-limited or replayed requests without replying. Pass a
    `signal` to bound any call that must settle.
  - `SCOPES` (and `Scope`) gain the scopes the host now grants: `apps:storage`,
    `apps:storage:publish`, `apps:store:items:write`, `goods:read:self` and
    `goods:purchase:self`.
  - `BlockSnapshot.viewer`'s doc pointed at `/me`, which refuses a block token; it now
    says `app.site.get('blocks/me')`.

  `@civitai/app-sdk`: `ViewerInfo.id`/`username`'s deprecation notes name
  `app.site.get('blocks/me')` for blocks outside React, not only `useViewer()`.

### Patch Changes

- 4e17c0c: The host reply ledger is regenerated from a host snapshot that declares every request's
  reply keys, so no request type is left to guess its reply shape from the payload.

  - Eight replies whose keys were unknown now have them: `CREATE_POST_FROM_APP`,
    `PREPARE_TRAINING_DATASET`, `PUBLISH_GENERATION_OUTPUTS` and `SET_COLLECTION_FOLLOW`
    (nested under `result`), `ESTIMATE_WORKFLOW_BATCH` (`aggregate`, `snapshots`),
    `OPEN_IMAGE_PICKER` (`selected`, `selectedImages`), and `RUN_CONFIRMED_STEP` and
    `RUN_TRAINING` (`snapshot`). Reply names and framing are unchanged, and a reply in the
    shape the host sends resolves exactly as before.
  - A success reply to one of the four `result` types that carries no `result` now rejects
    with `BridgeError` `malformed` ("reply carried no result") instead of resolving its
    bare fields. For `host.publishGenerationOutputs()` it already rejected `malformed`;
    only the message changes in that case.

## 0.12.1

### Patch Changes

- 4ecd491: `app.workflows.submit` docs (README and JSDoc): drop the claims that a submit naming a new quote is a new run and that the quote identifies a `kind: 'training'` run, neither of which held for a training body, and stop presenting `list()` as proof that a submit did not happen — a listed workflow carries no idempotency key.

## 0.12.0

### Minor Changes

- 7f1b93c: **`@civitai/sdk`: `app.workflows`, generation for a block, multi-step workflows included.**

  A block built on `@civitai/sdk` can now estimate, submit, follow and cancel a generation without hand-writing requests or importing types from another package:

  ```ts
  import { initialize, type WorkflowBody } from "@civitai/sdk";

  const app = await initialize();
  const body: WorkflowBody = {
    kind: "workflow",
    steps: [
      /* … */
    ],
  };

  const estimate = await app.workflows.estimate(body);
  if (estimate.status !== "failed") {
    const idempotencyKey = crypto.randomUUID(); // one per viewer action, reused on every retry
    const submitted = await app.workflows.submit(body, { idempotencyKey });
    if (submitted.status !== "failed") {
      const done = await app.workflows.wait(submitted.workflowId);
    }
  }
  ```

  - `app.workflows` has `estimate`, `submit`, `get`, `watch`, `wait`, `cancel` and `list`. They go through the host's `/api/v1/blocks/workflows/*` routes, so the host prices, budgets and attributes the work. Every body kind those routes accept works, `kind: 'workflow'` included. It needs the block token and the `ai:write:budgeted` scope.
  - It is a different client from `app.orchestration`, which calls the orchestrator directly with an OAuth access token and still refuses a block token. Its refusal message now names `app.workflows`.
  - A refusal is an answer, not a throw. When the host declines to price or run a body it replies with a snapshot whose `status` is `'failed'`, with `error`, often an `errorCode`, and for a budget refusal the `cost.total` it would not charge. Every call resolves with that snapshot. A call rejects only when the request itself was refused (`ApiError`, with the HTTP status) or a reply carried no snapshot (`CivitaiError`).
  - One reply is neither: when the host could not confirm whether a viewer-confirmed run (a `kind: 'training'` body, or a step with a `quoteId`) was created, `submit` rejects with the new exported `SubmissionUnconfirmedError`, which carries the snapshot. That run may be running and charged, so do not report it as "nothing spent" and do not resubmit blindly; check `app.workflows.list()` first.
  - A resolved `failed` snapshot from `submit` with the placeholder id `'failed'` means that request was refused before it was submitted; it says nothing about an earlier attempt that ended unknown. One with a real id is a run that was created and failed, and Buzz may have been spent.
  - `app.workflows` takes the block token only. A block holding an OAuth access token is answered `401`, and the error message says to use `app.orchestration`.
  - `submit` requires an `idempotencyKey` and rejects before sending without one. Mint it once per viewer action and reuse it on every retry. `submit` does not retry a failed request on its own.
  - A rejected `submit` is not "not started". After a `5xx`, a `409` or no answer the outcome is unknown: retry with the same key or check `app.workflows.list()`, and never mint a new key for the same viewer action. For a `kind: 'training'` body or a step with a `quoteId` the host identifies the run by the quote, not the key, so check `list()` before confirming a new quote.
  - `watch` and `wait` hold each read on the host, space their reads, wait out a brief outage and stop on a refusal. Pass a `signal` to stop early.
  - The contract types are exported from the package root: `WorkflowBody` and its members (`WorkflowBodyWorkflow`, `WorkflowBodyWorkflowStep`, `WorkflowStepRef`, `WithWorkflowStepRefs`, `WorkflowBodyTextToImage`, …), `BlockWorkflowSnapshot`, `KnownBlockWorkflowErrorCode` and `AppWorkflow`. They are a generated copy of the types `@civitai/app-sdk/blocks` defines, kept identical by a guard test.

  Nothing existing changed: `app.orchestration`, `app.site`, `app.storage` and `app.sharedStorage` behave as before.

  **`@civitai/app-sdk`, `@civitai/blocks-react`: README only.** Each README now opens with a short note on which package to start from: `@civitai/sdk` is the client new block apps start on, `@civitai/app-sdk/blocks` is the body-type and message contract, and `@civitai/blocks-react` is the React hook binding over the same host contract. All three remain supported. No code changed in either package.

## 0.11.1

### Patch Changes

- 469e645: **`BLOCK_READY` now reports which SDK the block was built with, and its version.**

  The `BLOCK_READY` payload gains two optional fields:

  - `sdkName`: which package's transport sent the message. `'blocks-react'` for `@civitai/blocks-react`, `'sdk'` for `@civitai/sdk`. The two packages version independently, so a version alone cannot tell them apart.
  - `sdkVersion`: that package's plain semver, with no package name and no `v`.

  Both transports now send them, so the host can see which SDK versions are in use.

  They are informational. Neither is a protocol version and nothing is negotiated on them. They are optional in both directions: blocks built before this release omit them, and a host that does not read them ignores them. No migration is needed.

  `@civitai/app-sdk`: type only. `BlockToParentMessage`'s `BLOCK_READY` payload is now `{ height: number; sdkVersion?: string; sdkName?: 'blocks-react' | 'sdk' }`.

## 0.11.0

### Minor Changes

- ef0baf3: **Custom events: the docs now state the real contract, and `dev:live` warns about events production would drop.** Both hosts forward `TRACK_EVENT`, and the platform records an event only when the app's APPROVED manifest declares it under `analytics.events`.

  - `@civitai/blocks-react`: `useBlockAnalytics()`'s TSDoc and README section are rewritten. They no longer promise that every event reaches a pipeline. They now say: only declared events are recorded (an undeclared one is counted as a drop and its name is not stored); only declared properties of the declared type are kept; there is no free-text string type (`enum`, `number`, `boolean`); each mount may send 10 events a second and 500 in total, in bodies of at most 32 KiB, and an over-limit event is dropped in the browser and counted nowhere; events are fire-and-forget; owners see aggregates in the app's analytics panel. The hook itself is unchanged.
  - `@civitai/blocks-react/live`: new optional `LiveHostOptions.manifest`. Pass your imported `block.manifest.json` and every `TRACK_EVENT` is checked against its `analytics.events`. The console warns ONCE per distinct problem: an undeclared event, an undeclared property, or a value that does not match the declared type or enum. A declared, valid event logs nothing. The check never throws and never blocks the block, and there is still no reply. Without `manifest`, the first `TRACK_EVENT` says the check is off. Typed `unknown` because an imported JSON file widens its string literals.
  - `@civitai/sdk`: new `app.host.track(eventName, properties?)`, which sends `TRACK_EVENT` on the same wire as `useBlockAnalytics().track`. `BREAKING.md` moves `TRACK_EVENT` from "Not carried" to carried and states the declared-only contract.
  - Examples: every `starters/examples/*` `dev:live` harness passes `manifest`. `page-app` now declares its six events, and stops sending `modelId`, which no declaration can carry: property names are snake_case, and a number property should not carry an identifier.

## 0.10.2

### Patch Changes

- 9887295: docs: the README's `auth: "oauth"` opt-in now names its two other conditions

  The `initialize()` section said a block opts in to an OAuth token by declaring `auth: "oauth"`, and
  left out two things the host enforces: the manifest must also declare `user:read:self` (every OAuth
  token carries it, so on civitai.com the host never mints one without it and hands back the block
  token; the dev tunnel mints one regardless, so the omission only shows up after approval), and
  `auth: "oauth"` cannot be declared alongside any `apps:storage:*` scope (such a manifest is refused
  at submit). `@civitai/components-chat`'s README now links here instead of keeping its own copy.

  Prose only, no behaviour change. A patch release because the README ships in the package.

## 0.10.1

### Patch Changes

- a62f280: Classify the two refusals civitai.com now sends when a publishing call needs the
  viewer's signed-in session. A bare `UNAUTHORIZED` (the session ended, e.g.
  signed out in another tab) is now `unauthenticated` in `@civitai/sdk` and sets
  `CreatePostError.signInRequired` in `@civitai/blocks-react`, so an app offering
  sign-in on that branch shows it instead of "unavailable". "…belongs to a
  different account; reload the page to continue" is now `forbidden` in
  `@civitai/sdk`; its message tells the viewer to reload. Existing mappings are
  unchanged.

## 0.10.0

### Minor Changes

- 2895c67: `NAVIGATE` carries an explicit `scope`, defaulting to `'app'`.

  The SDK side of the host contract merged in civitai/civitai#5250. `NAVIGATE`'s
  payload is now `{ path, scope?, target }`, where `scope` selects the **space**
  `path` is resolved in and `path` is a path _within_ it:

  - `'app'` — under the block's own route, pushed shallowly. **The default.**
  - `'site'` — at the civitai.com root, non-shallow, the viewer leaves the app.
    Granted per-surface; `/api/*` is refused in this scope regardless.

  A leading slash carries no meaning — the host normalises it away in _both_
  scopes, so `'/settings'` and `'settings'` are one request. Intent lives in the
  field, not in punctuation.

  **Nothing an existing block sends changes meaning.** `scope` is omitted rather
  than sent as `undefined` when a caller does not choose one, so an unscoped call
  puts a byte-identical payload on the wire; and the host compares against the
  literal `'site'` rather than validating against the union, so an absent _or
  unknown_ value fails closed onto `'app'`. Both spellings of a path were
  app-scoped before this field existed, which is the whole reason the default is
  `'app'` and not `'site'`.

  `useCivitaiNavigate`'s second argument is widened from `'current' | 'new_tab'` to
  that union _or_ an options object (`{ scope, target }`). The two-argument call
  shape keeps working unchanged; widening the parameter rather than adding an
  overload keeps one published signature, so `UseCivitaiNavigate` still describes
  the hook exactly. New exported types: `BlockNavigateScope`
  (`@civitai/app-sdk/blocks`), `UseCivitaiNavigateOptions` (`@civitai/blocks-react`)
  and `NavigateScope` (`@civitai/sdk`) — each required so the option is nameable
  rather than inline.

  🔴 **The dev host (`@civitai/blocks-react/live`) changes behaviour, and that is
  the point.** It resolved _every_ path against the backend origin — "so an in-app
  path (`/models/123`) opens on the real site" — while production resolved the same
  call under the block's own route. So `dev:live` and the published docs agreed with
  each other and production was the odd one out, which is what made a platform bug
  look like a block bug. It now mirrors the merged contract, `'app'` default
  included: an unscoped path stays on the dev origin (`pushState`, and the real
  `ROUTE_CHANGED` the host sends — see the separate changeset for that message;
  an earlier revision of this change dispatched a synthetic `popstate` instead and
  that was itself a divergence), `scope: 'site'` goes to the backend
  origin, an unknown scope fails closed onto `'app'`, and — a second divergence in
  the same handler — an absolute URL or protocol-relative path is now **dropped**
  rather than followed, because the host refuses any scheme in either scope. The
  host's hostile-path battery is deliberately _not_ mirrored: it guards an untrusted
  iframe, and `dev:live` has no untrusted party, so a second non-authoritative copy
  of a security resolver would buy nothing and drift.

  `minor` rather than `major` on the strength of the package's own published terms:
  the one surface whose behaviour moves is `/live`, whose README "Stability of
  `/live`" section reads _"a normal subpath of a `0.x` package where a minor may
  break it, with the runtime symbol set pinned by `test/subpathSurfaces.test.ts` so
  it cannot change silently"_ — and that symbol set is unchanged here.

  **No drift guard against the host's own `NavigateScope`, and the reason is not
  the one first written down.** A guard comparing this SDK's two-member union
  against `civitai/civitai`'s was priced and declined. The rationale recorded at
  the time was wrong twice and is corrected here, because a wrong rationale is what
  the next PR cites:

  - It leaned on #498's precedent. That deleted a **self-referential tautology** —
    a literal compared against a literal, with no production code on either side.
    A host-union guard is the opposite shape: it compares against another repo's
    live source, which is a real claim that can really go stale.
  - It offered `typecheck:readme` as covering the same ground. It does not.
    `typecheck:readme` pins **README ↔ this repo's union**; the question a drift
    guard answers is **SDK ↔ host**. Different operands, different question.

  The decision stands, for the property neither bullet named: **drift fails closed
  by construction.** The host resolves `obj.scope === 'site' ? 'site' : 'app'`, so
  a host that gains a third space still honours this SDK (an unknown value lands in
  `'app'`, the narrower one), and a host that _loses_ `'site'` degrades to `'app'`
  too. There is no divergence a guard would prevent — only one it would _announce_.
  A guard here buys a notification, not a safety property, and its standing cost (a
  third sparse path in the drift job, plus breakage every time the host moves that
  file) is paid against that. The behaviour that makes the drift safe is pinned by
  value instead, by the `an UNKNOWN scope fails CLOSED onto app, like the host`
  test — an assertion about state, not about wording.

  Also fixes an instrument, because this change tripped it:
  `test/blocks/blockToParentMessageTypes.test.ts` stripped block comments _before_
  line comments, so a `//` comment containing the two bytes `/*` — a path glob like
  `/api/*` — opened a phantom block comment that ate the rest of the region.
  Measured: the derived union went from 47 members to 27, failing the control with
  `expected 27 to be greater than or equal to 40`, a number that names nothing about
  the cause.

- 2895c67: `ROUTE_CHANGED` is modelled: a page block can finally see where it navigated to.

  The host has been sending this message since the page surface shipped
  (civitai/civitai `src/components/AppBlocks/PageBlockHost.tsx` —
  `send('ROUTE_CHANGED', { subPath })` in an effect gated on
  `!initSentRef.current || status !== 'ready'` and keyed on `[subPath, status]`).
  This SDK modelled it **nowhere**, so a block could not subscribe to it at all.
  The consequence was the civitai#5209 shape: in production an app-scoped
  `navigate()` moved the host's URL and the block never learned, because
  `BLOCK_INIT` — which carries the initial `subPath` — is deduped by the transport
  and could not deliver a second value.

  New surfaces:

  - **`@civitai/app-sdk`** — `ROUTE_CHANGED` on `ParentToBlockMessage`, payload
    `{ subPath: string }`. Declared beside `THEME_CHANGE`, the host→block push it
    is shaped after: no `requestId`, no reply, nothing awaits it.
  - **`@civitai/blocks-react`** — **`useCivitaiRoute()`** (and its
    `UseCivitaiRoute` return type), returning the sub-path currently showing. The
    transport folds the push into `context.subPath`, so
    `useBlockContext().context.subPath` tracks the same value — there is one
    writer and one copy.
  - **`@civitai/sdk`** — `ROUTE_CHANGED` on `HostMessage`, folded into the
    snapshot, so `app.context.subPath` is live and `onChange` reports it. **No
    `onRouteChange` and no `HostPushes` row**, matching `THEME_CHANGE`: a value the
    snapshot already holds is observed through the snapshot, and publishing a
    second reader of one value is how `app.context.subPath` and a callback end up
    disagreeing. `SUSPEND`/`RESUME` are in `HostPushes` because they carry no
    state.

  **A value hook, not an `onRouteChanged` callback — and that follows from the
  wire, not from taste.** The host sends the FIRST sub-path in
  `BLOCK_INIT.context.subPath` and sends this message only on a later _change_. A
  callback therefore cannot see where the block started, and a change that lands
  before its subscription effect runs is lost — a block that looks subscribed and
  misses the first move, which is the same failure wearing a different hat. The
  sub-path also already lives in `context`, so a callback that did not update the
  snapshot would leave `useBlockContext().context.subPath` frozen at its mount-time
  value while the callback reported another — exactly the divergence
  `applyThemeChange` exists to avoid, and the reason the push is folded in whatever
  the hook's shape.

  `''` is a real route (an app's own index) and the validator accepts it
  deliberately: `isValidRouteChanged` checks for a string, not a non-empty one,
  mirroring `isPageSlotContext`'s decision about the same field. Rejecting it would
  drop every navigation back to the app root.

  **Back-compat, both directions — purely additive.** An old block on a new host
  has no handler and falls through the transport's no-op tail, keeping the
  sub-path it got at init. A new block on an old host waits on nothing: the value
  simply never moves. On a model slot the push cannot even apply — the transport
  only ever UPDATES a `subPath` the context already carries and never introduces
  one, so it never asserts a page context the host did not send.

  🔴 **The dev host (`@civitai/blocks-react/live`) changes behaviour again, and
  this replaces something that shipped earlier in this same release.** That earlier
  revision dispatched a synthetic `popstate` after `pushState` _"since this SDK
  models no `ROUTE_CHANGED`"_. It made a history-based router in the block
  re-render — in `dev:live` and nowhere else, because no production host dispatches
  a `popstate` for its own shallow push. That is civitai#5209's failure class with
  its sign flipped, in a harness whose entire purpose in this release was to stop
  diverging from production; a dev host that is KINDER than production is how that
  bug stayed invisible in the first place. The synthetic event is gone and the dev
  host now emits the real message, with the host's own three gates: after init,
  only on a change, and only for a move of THIS frame (so neither
  `scope: 'site'` nor `target: 'new_tab'` emits). It also reflects the viewer's own
  back/forward, which production reports too — its effect is keyed on the resolved
  sub-path, not on who asked for the move.

  Also in the dev host: **the site-scope `/api/*` refusal now compares the DECODED
  first segment**, like the host's `navigateSiteFirstSegmentIsRefused`, and refuses
  a segment it cannot decode at all. It previously compared the raw spelling, so
  `%61pi/auth/logout` was refused in production and followed in `dev:live`. The
  branch mirrors a _published_ refusal rather than guarding anything, which is why
  it was fixed rather than deleted: a mirror that is wrong for one input shape is
  worse than either having it or not. This is not the host's "two spellings of one
  rule" case — that deleted a redundant raw fast path sitting _alongside_ a decoded
  comparison and provably unable to reach a verdict the survivor did not; here
  there was one comparison and it was the wrong one.

  `minor` on the same terms as the rest of this release: additive on the API axis
  (a new hook, a new message type, no rename and nothing narrowed), with the one
  behaviour change confined to `/live`, whose README is explicit that it is _"a
  normal subpath of a `0.x` package where a minor may break it"_ and whose runtime
  symbol set — pinned by `test/subpathSurfaces.test.ts` — is unchanged.

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
