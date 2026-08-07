---
'@civitai/app-sdk': minor
---

Pin `WORKFLOW_STEP_TYPES` / `IMAGE_GEN_ENGINES` to the orchestrator spec — and remove a phantom step type that never existed.

`WORKFLOW_STEP_TYPES` advertises itself as "every workflow step type the orchestrator accepts". It was not. Measured against the `WorkflowStepTemplate` discriminator mapping in `https://orchestration.civitai.com/openapi/v2-consumers.json` (the submit-side union — the defining surface, not a sample of schema names):

- **`audioMix` did not exist.** It appears **0 times** in the spec. An author who found it in the catalog or took it from autocomplete and submitted `{ $type: 'audioMix' }` got a 400 with nothing in the SDK to explain why. The real step is **`composeMedia`**, which composes an ordered element list into either an audio mixdown or a video composition (its output is discriminated on `type`). It is now in the catalog with that description and a note pointing at it from where `audioMix` used to be.
- **10 real step types were missing**: `customComfy`, `composeMedia`, `imageBackgroundRemoval`, `imageToSvg`, `videoBackgroundRemoval`, `polyGen`, `model3DPreview`, `training`, `shieldstralModeration`, plus `comfyNodepackSnapshot` / `qwenImageBench` (both labelled as platform internals — they are in the consumer spec, but a third-party app has no reason to submit one).

The catalog is now exactly the spec's 44 entries, and `IMAGE_GEN_ENGINES` is confirmed exactly its 11.

**How it stays that way.** The old guard was `expect(keys).toContain('textToImage')` over 7 of the then-34 names — a spot-check that cannot express either half of a drift, and did not catch either half of this one. It is replaced by two checks that together pin the catalogs to the live spec:

- `test/orchestrator.test.ts` compares the catalogs to lists **transcribed from the spec** into `test/fixtures/orchestrator-spec-catalogs.json` — exact set equality plus separately-named phantom / missing assertions, a non-blank-description check, and a positive control asserting the expectation itself is non-empty (every other assertion in that block passes vacuously against an empty fixture).
- `pnpm check:catalogs` (`scripts/check-orchestrator-catalogs.mjs`, wired into CI as an advisory job alongside the existing schema-drift check) re-fetches the **live** spec and diffs the fixture against it, reporting STALE and MISSING separately. An unreachable spec, a missing discriminator, or an empty mapping all FAIL — a drift check that skips reads exactly like one that passes.

Neither alone is sufficient: the unit test cannot see the orchestrator shipping a new step type, and the script does not read the SDK source at all.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so dropping `audioMix` removes it from that union. Assignment sites are unaffected (`BuildWorkflowBodyStep.$type` is `WorkflowStepType | (string & {})` and always was), but an explicit `const t: WorkflowStepType = 'audioMix'` stops compiling — which is the correct outcome, since that value was never submittable.

No runtime behaviour changes. The block-facing `@civitai/app-sdk/blocks` surface (`WorkflowBody` and friends) is untouched.
