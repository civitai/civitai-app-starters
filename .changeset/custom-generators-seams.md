---
"@civitai/app-sdk": minor
"@civitai/blocks-react": minor
---

Expose the Custom Generators platform seams to block apps.

`@civitai/app-sdk/blocks` (contract):

- `WorkflowBody.textToImage` gains optional `sourceImage?: BlockSourceImage` (`{ url, width, height }`) for img2img — Civitai-hosted image, SD-family checkpoints, page apps only; all server-enforced. New `BlockSourceImage` interface.
- `WorkflowBody.textToImage` gains optional `sharedContentKey?: string` — the shared-storage key the server resolves to the content author for attribution.
- New `OPEN_IMAGE_UPLOAD` / `IMAGE_UPLOAD_RESULT` message pair (host-mediated block image upload) + `BlockUploadedImageInfo` (`{ imageId, nsfwLevel, contentRating, url }`), added to the inbound message validator.
- `BlockResourceInfo` widened with the public recommended-settings projection: `strength?`, `minStrength?`, `maxStrength?`, `trainedWords?`, `clipSkip?` (mirrors the host's `SafeGenerationResource`).
- `SharedStorageValue` gains an optional opaque `data?: unknown` (threaded through `SHARED_APPEND`).

`@civitai/blocks-react` (hooks/REST):

- New `useImageUpload()` hook (drives `OPEN_IMAGE_UPLOAD`).
- New `useGenerationResources()` hook + pure `buildGenerationResourcesUrl` / `responseToResources` builders for `GET /api/v1/blocks/generation-resources` (rehydrate picked resources by version id, ≤30 cap).
- `useSharedStorage().append` accepts the generic `{ title, body?, data? }` value.
- `createMockHost` answers `OPEN_IMAGE_UPLOAD` and echoes shared-storage `data`, so `dev:mock` / `dev:live` mirror prod.
