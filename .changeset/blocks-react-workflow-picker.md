---
'@civitai/blocks-react': minor
---

Add `WorkflowPicker` to `@civitai/blocks-react/ui`: `<civitai-resource-picker>` set up for `Workflows` and the retired `ComfyWorkflows` type, wired to `useHostOrigin()` and `useBlockToken().raw` so a viewer can pick one of their own posted workflows or anyone's (#663). Props: `open`, `onPick`, `onDismiss`, `owner`, `heading`, `source`. `/ui` also re-exports the picker's data types (`PickedResource`, `ResourceSource`, `ResourceItem`, …).

Add `fakeResourceSource({ mine, any })` to `@civitai/blocks-react/testing` (with the types `FakeResourceCanned` and `FakeResourceSource`): canned picker results for the mock host, which has no catalog. It filters by owner, type and query, echoes the owner it applied, and records each search on `.calls`.
