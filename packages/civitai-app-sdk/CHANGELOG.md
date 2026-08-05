# @civitai/app-sdk

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
