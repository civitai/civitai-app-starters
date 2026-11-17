---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**A training-data upload returns an AIR reference.** `useImageUpload({ purpose: 'trainingData' }).open()` resolves with `[{ air }]`, one AIR reference per uploaded image (or `null` on cancel). Pass each `air` as a `BlockTrainingDatasetItem.air`, as before.

- **Breaking type change:** `BlockTrainingDataImage` is now `{ air: string }`; its `url` field is removed. An app that showed `url` as a thumbnail should show a placeholder instead.
- **Transport:** the `IMAGE_UPLOAD_RESULT` validator requires only `air` on each training image. A `url` sent by an older host is ignored and not passed on.
- **Mock host:** the default and canned `trainingData` uploads answer `{ air }` only.
