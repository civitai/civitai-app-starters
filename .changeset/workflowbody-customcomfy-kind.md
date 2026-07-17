---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Convert `WorkflowBody` into a real discriminated union and add a bounded `customComfy` recipe member (App Blocks customComfy bridge, v1). Pure-additive and back-compatible: the existing `{ kind: 'textToImage', modelId, modelVersionId, params }` body is unchanged (now the exported `WorkflowBodyTextToImage` arm). The new `WorkflowBodyCustomComfy` (`{ kind: 'customComfy', recipe, params: { prompt, seed?, engine?, accountType? } }`) runs a server-registered, code-reviewed ComfyUI recipe end-to-end — the iframe never sends a graph; `recipe` is a registered id (unknown ids rejected server-side, fail-closed) and `params` are bounded + validated per-recipe. Mirrors civitai's forthcoming `blockCustomComfyBodySchema`. Billing is post-paid (a per-recipe display estimate, no exact pre-price; a per-recipe `maxBuzz`/timeout caps the job server-side). `useBuzzWorkflow().{estimate,submit}` now accept the full union (type-only; the hook forwards the body verbatim, no runtime change). `@civitai/blocks-react`'s peer range on `@civitai/app-sdk` is bumped to `^0.26.0` to match this minor.
