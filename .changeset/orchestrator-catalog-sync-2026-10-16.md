---
'@civitai/app-sdk': minor
---

Catalog sync: the orchestrator spec accepts 1 entry the SDK catalogs did not list.

- `IMAGE_GEN_ENGINES`: add the `krea3` imageGen engine

`WORKFLOW_STEP_TYPES` / `IMAGE_GEN_ENGINES` are hand-maintained mirrors of the `discriminator.mapping`s in `https://orchestration.civitai.com/openapi/v2-consumers.json`, which moves per orchestrator build — so they drift without anyone touching this repo. Read on 2026-10-16.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens an exported union. Purely additive: nothing that compiled before stops compiling, and there is no runtime behaviour change.
