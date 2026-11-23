---
'@civitai/app-sdk': minor
---

**`@civitai/app-sdk/save-zip` accepts `.glb` and `.fbx` entries.** `SAVE_ZIP_ALLOWED_EXTENSIONS` now also holds `glb` (binary glTF) and `fbx`, so a block can bundle a generated 3D model with its renders in one `SAVE_IMAGE { bytes }` zip. As for every entry, the validator checks the name, not the content. Every other rule is unchanged, and the glTF-JSON form (`.gltf`), its sidecar `.bin` and `.obj` are still refused (`zip entry type is not allowed: gltf`). The civitai.com host applies this once it depends on this release; until then a zip holding a `.glb` or `.fbx` is refused there.
