---
'@civitai/app-sdk': minor
---

Add `fetchGenerationSamplers` and `resolveGenerationSampler` to `@civitai/app-sdk/blocks`. They give the sampler options per model family that the on-site generator shows, read from `GET /api/v1/blocks/generation-samplers` with any block token.

- `fetchGenerationSamplers({ hostOrigin, token })` returns `{ ecosystems, baseModels }`. Each family carries `sampler: { options: { value, label }[], default } | null` plus per-model-version overrides.
- `resolveGenerationSampler(catalog, { baseModel, modelVersionId })` returns `{ known: true, sampler }`, where `sampler` is the control or `null` when the generator shows none. It checks the version override first, then the family. It returns `{ known: false, reason }` when the platform has no answer for that model, so an unknown family is never read as "no sampler".
- On a platform that predates the route (`404`), the getter throws `GenerationSamplersError` with `code: 'unsupported-platform'` instead of returning an empty list.
- `parseGenerationSamplers` validates a body you fetched yourself.
