# @civitai/app-sdk

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
