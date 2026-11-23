---
'@civitai/app-sdk': minor
---

**New subpath `@civitai/app-sdk/save-model3d`, and `@civitai/app-sdk/save-zip` accepts `.glb` and `.fbx` entries.**

- `@civitai/app-sdk/save-model3d` is the `SAVE_IMAGE { bytes }` check for binary glTF (`.glb`) and binary FBX (`.fbx`) 3D models, the one copy the civitai.com host and `@civitai/blocks-react`'s `createMockHost` share, like `./save-zip`. It exports `looksLikeSaveModel3d` (the prefix test that picks the cap), `isValidSaveModel3d` (the structural check), `SAVE_MODEL3D_MAX_BYTES` (100 MiB), `SAVE_MODEL3D_EXTENSION` and the `SaveModel3dType` type. Dependency-free, browser and Node. Not on the root barrel.
- `SAVE_ZIP_ALLOWED_EXTENSIONS` now also holds `glb` and `fbx`, so a block can bundle a generated model with its renders in one zip. As for every entry, the validator checks the name, not the content. `.gltf`, `.bin` and `.obj` are still refused.

The civitai.com host applies both once it depends on this release.
