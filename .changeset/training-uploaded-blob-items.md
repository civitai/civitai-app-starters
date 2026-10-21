---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**BREAKING (0.x minor): App Blocks `kind: 'training'` now trains on images the viewer uploads, not on a server-prepared dataset** — the SDK half of civitai/civitai#6461.

The training run is unchanged; how its dataset is named is not:

- `WorkflowBodyTraining.items: BlockTrainingDatasetItem[]` (`{ air, caption }`, 1–50, one blob at most once) **replaces** `datasetId`. `BLOCK_TRAINING_CAPTION_MAX_CHARS` is now 8,192.
- Upload the images with `useImageUpload({ purpose: 'trainingData' }).open()` (`OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`). The viewer picks up to 50 images in a Civitai modal; `open()` resolves with `[{ url, air }]` (`BlockTrainingDataImage[]`), or `null` on cancel. Pair each `air` with a caption.
- `RUN_TRAINING` gains the host code `training data not uploaded here`: the host refuses, before any dialog, a quote naming a blob it did not upload for this block (e.g. after a reload). `RunTrainingError.trainingDataNotUploaded` flags it; no run, nothing charged — upload again and estimate again.

Removed, with no replacement beyond the above:

- `@civitai/blocks-react`: `usePrepareTrainingDataset`, `UsePrepareTrainingDataset`, `PrepareTrainingDatasetError`, `PREPARE_TRAINING_DATASET_ERROR_CODES`, `isPrepareTrainingDatasetErrorCode`, and the `BlockPrepareTrainingDatasetHostError` / `BlockTrainingDatasetResult` / `BlockTrainingRejectionReason` re-exports. Mock host: the `trainingDatasetRejected` and `trainingDatasetError` options are gone; `cannedTrainingDataUpload` (the images an upload returns) and `trainingDataNotUploadedHere` (refuse every run as a host that forgot its uploads) are new, and the mock now checks a run's whole body against its quote.
- `@civitai/app-sdk/blocks`: the `PREPARE_TRAINING_DATASET` / `TRAINING_DATASET_RESULT` message pair, `BlockTrainingDatasetResult`, `BlockTrainingRejectionReason` and `BlockPrepareTrainingDatasetHostError`. New: the `'trainingData'` upload purpose, `BlockTrainingDataImage`, `BlockTrainingDataUploadResult` (the multi-image `IMAGE_UPLOAD_RESULT.selected` shape), and `BlockRunTrainingHostError` member `'training data not uploaded here'`.
- `@civitai/sdk`: the copied `WorkflowBodyTraining` follows (`items`, not `datasetId`), and `BlockTrainingDatasetItem` is exported from the package root. The host reply ledger is regenerated from civitai/civitai#6461.

Training from apps stays behind the host flag `app-blocks-training-kind` (off by default), page apps only.
