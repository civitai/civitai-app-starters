---
'@civitai/app-sdk': minor
---

`WORKFLOW_STEP_TYPES`: add `miniMaxMusic3` — the orchestrator accepts it and the catalog did not list it.

`WORKFLOW_STEP_TYPES` is a hand-maintained mirror of `components.schemas.WorkflowStepTemplate.discriminator.mapping` in `https://orchestration.civitai.com/openapi/v2-consumers.json`. That mapping is the defining surface for a step's `$type`, and it moves per orchestrator build — so the catalog drifts behind it without anyone touching this repo. Same class as the `qwen` drift in `IMAGE_GEN_ENGINES` (#229); this is the `WORKFLOW_STEP_TYPES` half.

It had drifted by exactly one entry. Re-reading the live mapping gives **45** keys; the catalog listed **44**, missing **`miniMaxMusic3`**. The mapping was diffed in both directions: nothing else is missing, and nothing listed has been withdrawn. `IMAGE_GEN_ENGINES` was re-checked in the same pass and is unchanged at exactly the spec's 12.

Not a rename of anything already present — `minimax` matched **0** times anywhere in `src/orchestrator/index.ts` (case-insensitive, fixed-string; `comfy` matched 10 as a positive control on that search), so it is genuinely new rather than a spelling change.

**What it is.** `MiniMaxMusic3StepTemplate` — *"Generate a complete song from a structured caption and lyrics with MiniMax Music 3."* It is the **second music engine alongside `aceStepAudio`**, and they are separate `$type`s rather than variants of one, so both belong in the catalog.

Three details a caller cannot infer from the name, and which are now in the JSDoc:

- `caption`, `lyrics` and `seed` are **all required** — `seed` in particular, which is optional on most steps.
- `lyrics` takes section markers: `[Intro]`, `[Verse]`, `[Chorus]`, `[Outro]`.
- `maxDuration` is an **upper bound, not a target** — the model may end the song earlier.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens that union — purely additive. Nothing that compiled before stops compiling, and there is no runtime behaviour change: this is a typing and discoverability fix.

The transcribed fixture (`test/fixtures/orchestrator-spec-catalogs.json`, `readOn` bumped to 2026-08-14) and the pinned expectation count in `test/orchestrator.test.ts` were updated in lockstep, which is what keeps the offline unit test and the live drift-check pinned to each other. That count guard was observed failing on this change before it was bumped (`expected … length 44, got 45`), so it is pinning something rather than passing vacuously.
