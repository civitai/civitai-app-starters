---
"@civitai/app-sdk": minor
"@civitai/blocks-react": minor
---

Add the `generationSource` image-upload mode to `OPEN_IMAGE_UPLOAD` (mirrors civitai/civitai #3141).

`@civitai/app-sdk/blocks` (contract):

- `OPEN_IMAGE_UPLOAD` request gains an optional `purpose?: 'display' | 'generationSource'`. Absent/omitted ⇒ `'display'` (the host normalizes an unknown value to the safe moderated default), so an older SDK stays byte-compatible.
- `IMAGE_UPLOAD_RESULT.selected` is now a UNION keyed by the requested purpose:
  - `'display'` (existing): the MODERATED `BlockUploadedImageInfo` (`{ imageId, nsfwLevel, contentRating, url }`) — unchanged.
  - `'generationSource'` (new): the UNSCANNED private img2img source `{ url, width, height }` (no imageId/nsfwLevel; the orchestrator scans it at generation time). Exported as `BlockGenerationSourceImageInfo` (an alias of the existing `BlockSourceImage` — `WorkflowBody.sourceImage`'s type).
- New exported `BlockUploadPurpose` (`'display' | 'generationSource'`) mirroring the host's type.

`@civitai/blocks-react` (hooks/mock):

- `useImageUpload()` accepts an options arg `useImageUpload({ purpose }?)`, typed by purpose via overloads: `purpose: 'generationSource'` → `open(): Promise<BlockGenerationSourceImageInfo | null>`; default / `'display'` → `open(): Promise<BlockUploadedImageInfo | null>`. The `purpose` is passed through on `OPEN_IMAGE_UPLOAD` (omitted for the default mode to keep the wire byte-compatible). Keeps the 10-min timeout + `selected ?? null` cancellation.
- The inbound `IMAGE_UPLOAD_RESULT` validator now accepts BOTH result shapes (moderated OR `{ url, width, height }`).
- `createMockHost` returns the canned result for the requested `purpose` (a `{ url, width, height }` for `generationSource`, the existing moderated result for `display`), with a new `cannedGenerationSourceUpload` scenario knob — so `dev:mock` works for both modes.
- Bumps the `@civitai/app-sdk` peer dependency to `^0.19.0`.
