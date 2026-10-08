---
'@civitai/app-sdk': minor
---

Catalog sync: two step types the orchestrator accepts are now in `WORKFLOW_STEP_TYPES`.

- `liveTextToSpeech`: streaming text-to-speech. Inputs mirror `textToSpeech`, limited to low-latency streaming voices; the step's output gives an input URL you post text chunks to and one continuous audio stream (`pcm` or `ogg`) for the whole session.
- `promptModeration`: listed under "Platform internals" — it serves Civitai's own pipelines and is not meant for third-party apps. It moderates a positive / negative prompt pair and returns a calibrated score, threshold and flag per label, along with the model and policy version used.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens an exported union. It is purely additive: nothing that compiled before stops compiling, and there is no runtime change. Both types sit in the `CatalogStepTypesWithoutAGeneratedType` ledger until `@civitai/client` republishes with templates for them.
