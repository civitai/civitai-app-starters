---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**A picked generation source can come back as a private scanned image.** While Civitai requires the generation sources apps send to be scanned images on Civitai (the host's `app-block-source-scanned-rows` flag), the host copies a file picked through `useImageUpload({ purpose: 'generationSource' })`, or a single `useMediaUpload()` image, into a private, scanned image owned by the viewer, and answers with that image instead of the raw upload.

- **Same API.** `open()` still resolves with `{ url, width, height }` (or `null` on dismiss), now typed `BlockUploadedGenerationSource`, which may also carry `imageId` and `ready` (see its docs).
- **New type** (`@civitai/app-sdk/blocks`, re-exported by `@civitai/blocks-react`): `BlockUploadedGenerationSource` (`BlockGenerationSourceImageInfo` plus optional `imageId` and `ready`), now the `generationSource` return of `useImageUpload` and a member of `IMAGE_UPLOAD_RESULT.selected`. `BlockMediaUploadInfo` gains the same two optional fields.
- **Transport:** the `IMAGE_UPLOAD_RESULT` and `MEDIA_UPLOAD_RESULT` validators accept both shapes.
- **Mock host:** `cannedGenerationSourceUpload` and `cannedMediaUploads.image` accept `imageId` and `ready`, to answer as the host does with the flag on. The defaults are unchanged (the raw-upload shape).
- **`@civitai/sdk`:** `host.openImageUpload({ purpose: 'generationSource' })` now passes `imageId` and `ready` through (`SourceImage` gains both, optional) instead of dropping them.
- An older SDK keeps working: it passes the two fields through (or ignores them), and its source is the scanned image's url.
