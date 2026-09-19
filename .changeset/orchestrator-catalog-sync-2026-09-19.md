---
'@civitai/app-sdk': minor
---

Catalog sync: the orchestrator spec accepts 4 entries the SDK catalogs did not list.

- `WORKFLOW_STEP_TYPES`: `imageScanning` — one scan over a single image returning every moderation signal at once (`nsfwLevel`, AI-generated and anime recognition, WD tags, human detection, joint age classification, `csam`). Filed under *Classification / tagging / moderation*; prefer it to chaining `wdTagging` + `ageClassification` + `xGuardModeration`.
- `WORKFLOW_STEP_TYPES`: `preprocessVideo` — the video-side counterpart of `preprocessImage`: a ControlNet-style preprocessor (`canny`, `hed`, `mlsd`, `dwpose`, `depth-anything-v2`) over a source video, with `resolution` targeting the shorter edge. Filed under *Video gen*.
- `WORKFLOW_STEP_TYPES`: `yuE2` — song generation from a `style` description plus `lyrics`, with optional ABC score planning (`mode`: `full` / `melody` / `off`). The third music engine alongside `aceStepAudio` and `miniMaxMusic3`. Filed under *Audio*.
- `IMAGE_GEN_ENGINES`: `flux1-pro` — the FLUX.1 Pro family, `model` selecting `pro` or `ultra`.

`WORKFLOW_STEP_TYPES` / `IMAGE_GEN_ENGINES` are hand-maintained mirrors of the `discriminator.mapping`s in `https://orchestration.civitai.com/openapi/v2-consumers.json`, which moves per orchestrator build — so they drift without anyone touching this repo. Read on 2026-09-19.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens an exported union. Purely additive: nothing that compiled before stops compiling, and there is no runtime behaviour change.

The mechanical half was written by `scripts/sync-orchestrator-catalogs.mjs`; the three placeholder descriptions it left (`imageScanning`, `preprocessVideo`, `flux1-pro`) have been written by hand from each step's `<Name>Input` / `<Name>Output` schemas, and every entry moved out of the auto-added block into its semantic section. `pnpm check:catalogs` is green: 50 step types and 14 imageGen engines, both matching the live mappings, no placeholders left. Watched red first on the pre-edit tree, where it named all three.
