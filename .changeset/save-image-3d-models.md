---
'@civitai/blocks-react': minor
---

**`useSaveImage()` and `createMockHost` handle a `{ bytes }` save of a binary glTF (`.glb`) or binary FBX (`.fbx`) 3D model.** The host now classifies these by structure and saves them under `.glb` / `.fbx`, with a 100 MiB per-file cap (other types keep 50 MiB, a zip 256 MiB).

- **`useSaveImage()`** applies the 100 MiB cap to a buffer that starts like a GLB (`glTF` + container version 2) or a binary FBX (`Kaydara FBX Binary  \0`). Before, it refused any such buffer over 50 MiB before sending it, so a large model never reached the host.
- **`createMockHost`** runs the host's check: a GLB must declare a length equal to the buffer's and hold a JSON chunk that parses to a glTF document, then at most one BIN chunk, the chunks 4-byte aligned and filling the file; an FBX must be binary (version 6100 to 7999) with top-level node records ending in the null record and at most 256 bytes after it. A buffer that starts like either but fails is refused with `file type is not allowed`. `onSaveBytes` reports `model/gltf-binary` or `model/x-fbx`.
- A host that predates model saves refuses them with `file type is not allowed`.
