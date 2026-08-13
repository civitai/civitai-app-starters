---
'@civitai/app-sdk': minor
---

`IMAGE_GEN_ENGINES`: add `qwen` — the orchestrator accepts it and the catalog did not list it.

`IMAGE_GEN_ENGINES` is a hand-maintained mirror of `components.schemas.ImageGenInput.discriminator.mapping` in `https://orchestration.civitai.com/openapi/v2-consumers.json`. That mapping is the defining surface for the `engine` field of an `imageGen` step, and it moves per orchestrator build — so the catalog drifts behind it without anyone touching this repo.

It had drifted by exactly one entry. Re-reading the live mapping gives **12** keys; the catalog listed **11**, missing **`qwen`**:

`comfy`, `fal`, `flux1-kontext`, `flux2`, `gemini`, `google`, `grok`, `openai`, **`qwen`**, `sdcpp`, `seedream`, `wan`

`qwen` maps to `QwenApiImageGenInput` — Qwen image models hosted by Alibaba Model Studio (DashScope), distinct from running Qwen-Image on our own workers via `sdcpp`. It is now in the catalog with that description. The full mapping was diffed in both directions: nothing else was missing, and nothing listed has been withdrawn. `WORKFLOW_STEP_TYPES` was re-checked in the same pass and is unchanged at exactly the spec's 44.

**Why `minor`.** `ImageGenEngine` is `keyof typeof IMAGE_GEN_ENGINES`, so this widens that union — purely additive. Nothing that compiled before stops compiling; `engine` was already accepted as a pass-through field, so this is a typing and discoverability fix rather than a new capability. No runtime behaviour change.

The transcribed fixture (`test/fixtures/orchestrator-spec-catalogs.json`) and the pinned expectation count in `test/orchestrator.test.ts` were updated in lockstep, which is what keeps the offline unit test and the live drift-check pinned to each other.
