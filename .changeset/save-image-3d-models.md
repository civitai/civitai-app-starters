---
'@civitai/blocks-react': minor
---

**`useSaveImage()` and `createMockHost` handle a `{ bytes }` save of a binary glTF (`.glb`) or binary FBX (`.fbx`) 3D model.** The hook's pre-send cap is now 100 MiB for a buffer that starts like one (before, a model over 50 MiB never reached the host), and `createMockHost` checks models with `@civitai/app-sdk/save-model3d`, loaded on the first model save. The rules, caps and refusal strings are in the README under `useSaveImage()`, "`{ bytes }` holding a 3D model".
