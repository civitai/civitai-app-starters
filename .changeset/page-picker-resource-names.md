---
"@civitai/app-sdk": minor
---

Add `modelName` + `versionName` to `BlockResourceInfo` (the PAGE resource picker
result that `useResourcePicker` resolves to + the `RESOURCE_PICKER_RESULT`
payload). These are the public display names of the user-picked resource, so a
block can render the chosen Checkpoint/LoRA by name instead of `#<id>` — mirrors
the names `BlockCheckpointInfo` (the model-slot/checkpoint picker) already
carries. The host projection in civitai/civitai's `PageBlockHost.tsx` is updated
in lockstep.
