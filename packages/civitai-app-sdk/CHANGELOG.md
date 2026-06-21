# @civitai/app-sdk

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
