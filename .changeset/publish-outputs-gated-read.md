---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the `PUBLISH_GENERATION_OUTPUTS`/`PUBLISH_RESULT` and `GET_IMAGES_BY_IDS`/`IMAGES_RESULT` block↔host message pairs, the `BlockGatedImage` per-viewer gated-image projection, and the `usePublishGenerationOutputs()` + `useGatedImages()` hooks. Bridges a block's own generation outputs into bare real-scanned public Image rows and reads them back under each viewer's browsing-level clamp.
