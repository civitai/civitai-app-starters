# @civitai/app-sdk

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
