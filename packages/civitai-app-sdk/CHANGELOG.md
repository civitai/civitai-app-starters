# @civitai/app-sdk

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
