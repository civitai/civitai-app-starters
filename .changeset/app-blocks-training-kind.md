---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

App Blocks `kind: 'training'` — train a LoRA from a page app, priced by a real quote and confirmed by the viewer in Civitai's own dialog.

Requires a civitai.com host carrying civitai/civitai#5434 and civitai/civitai#5438, with the host flag `app-blocks-training-kind` enabled for the viewer (it ships off). Page apps only, `ai:write:budgeted`, and refused from development and review sessions.

**`@civitai/app-sdk`**

- `WorkflowBodyTraining` (`kind: 'training'`) joins the `WorkflowBody` union, with `AiToolkitTrainingParams` mirroring the host's ai-toolkit schema. No `maxBuzz`, no timeout knob.
- `BlockWorkflowSnapshot.trainingQuote` — `{ quoteId, total, imageCount, expiresAt }` on a training estimate.
- Messages `PREPARE_TRAINING_DATASET` → `TRAINING_DATASET_RESULT` and `RUN_TRAINING` → `TRAINING_RESULT`, with `BlockTrainingDatasetItem`, `BlockTrainingDatasetResult`, `BlockTrainingRejectionReason`, and the host refusal codes `BlockPrepareTrainingDatasetHostError` / `BlockRunTrainingHostError`.
- The host bounds as constants: `BLOCK_TRAINING_MAX_BUZZ_PER_RUN` (5000), `BLOCK_TRAINING_DATASET_MAX_ITEMS`, `BLOCK_TRAINING_CAPTION_MAX_CHARS`, `BLOCK_TRAINING_SAMPLE_PROMPTS_MAX`, `BLOCK_TRAINING_SAMPLE_PROMPT_MAX_CHARS`, `BLOCK_TRAINING_TRIGGER_WORD_MAX_CHARS`, `BLOCK_TRAINING_MODEL_KEY_MAX_CHARS`.

**`@civitai/blocks-react`**

- `usePrepareTrainingDataset()` → `prepareDataset(items)` with `PrepareTrainingDatasetError`. Prompts for `ai:write:budgeted` and retries once on a grant. Sent under the 120s server-work bound (the server's image import alone may take 60s).
- `useRunTraining()` → `runTraining({ ...body, quoteId })` with `RunTrainingError` (`.declined` = no run; `.unconfirmed` = a run may exist, check before retrying). Ten-minute consent bound; never auto-retried.
- `useBuzzWorkflow().estimate()` returns the quote; `useBuzzWorkflow().submit()` now refuses a `kind: 'training'` body before sending anything.
- Inbound validators for both replies and for `trainingQuote` (error fields shape-checked only, rejection reasons checked as strings).
- Mock host: a kind-faithful training path (stored datasets and quotes, the 5,000 ceiling, single-use quotes) with knobs `trainingDatasetRejected`, `trainingDatasetError`, `trainingQuoteTotal`, `runTrainingError`; `generation.trainedEpochs` now also applies to a `kind: 'training'` run.
- `dev:live` refuses both training bridges, as the server refuses development tokens for training.
