---
"@civitai/app-sdk": minor
"@civitai/blocks-react": minor
---

Add the PAGE resource picker (Design 1 — host-chrome): `useResourcePicker()` +
the `OPEN_RESOURCE_PICKER` / `RESOURCE_PICKER_RESULT` message pair.

This generalizes the existing model-slot `OPEN_CHECKPOINT_PICKER` /
`useCheckpointPicker` flow to App Block PAGES, and widens it from Checkpoint-only
to a typed allowlist — v1 accepts `'Checkpoint' | 'LORA'` only
(`BlockResourcePickerType`). The block asks the host to open its OWN native
resource modal as host chrome; the user searches in host chrome (NOT the iframe);
the host returns ONLY the single chosen resource as the narrow `BlockResourceInfo`
(`{ versionId, modelId, baseModel, modelType }`). The iframe never receives the
catalog, a list, or any resource it didn't pick.

`@civitai/app-sdk` additions: `BlockResourceInfo`, `BlockResourcePickerType`, and
the two message variants. `@civitai/blocks-react` adds `useResourcePicker()`
whose `open({ resourceType, baseModelGroup? })` resolves with the chosen
`BlockResourceInfo` or `null` when the user dismissed.

Discovery only: the returned `versionId` is a hint, never an entitlement — feed
it into `body.modelVersionId` (Checkpoint) or `body.additionalResources` (LoRA)
and the host re-validates every id server-side at estimate/submit (the page gate
+ orchestrator belt). Purely additive and backward-compatible. The host side
ships in civitai/civitai (`PageBlockHost` `OPEN_RESOURCE_PICKER` handler); a block
can consume this hook once a version of these packages is published.
