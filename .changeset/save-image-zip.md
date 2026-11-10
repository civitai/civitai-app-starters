---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

`useSaveImage({ bytes })` can save a `.zip` (e.g. an image dataset with caption files): a buffer that starts like a zip is held to a 256 MiB cap instead of 50 MiB before sending, and the host validates the archive (entry types png/jpg/jpeg/webp/txt/json/csv, safe paths, no duplicates, stored or deflate, no encryption or zip64, at most 10,000 entries and 1 GiB uncompressed) and saves it as `<name>.zip`. `createMockHost` runs the same validator and reports `application/zip` through `onSaveBytes`. Needs a host with civitai/civitai#8420; an older host refuses a zip with `file type is not allowed` (or `file exceeds the maximum save size` over 50 MiB).

`@civitai/app-sdk`: new subpath `@civitai/app-sdk/save-zip` — the zip validator (`validateSaveZip`, `verifySaveZipInflate`, `looksLikeSaveZip`, `SAVE_ZIP_MAX_BYTES`, `SAVE_ZIP_LIMITS`, `SAVE_ZIP_ALLOWED_EXTENSIONS` and the `SAVE_ZIP_*_ERROR` strings). It is the one copy: the civitai.com host and `createMockHost` both import it. Dependency-free; needs `DecompressionStream` (browsers, Node >= 18) for the inflate check.

`@civitai/blocks-react`: the `@civitai/app-sdk` peer floor rises from `>=0.57.0` to `>=0.85.0`, because `useSaveImage` and `createMockHost` now import `@civitai/app-sdk/save-zip`. Upgrade `@civitai/app-sdk` together with this release.
