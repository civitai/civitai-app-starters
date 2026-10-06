---
'@civitai/app-sdk': minor
---

Catalog sync: two step types the orchestrator accepts are now in `WORKFLOW_STEP_TYPES`.

- `liveTranscription`: live speech-to-text from audio streamed while the user talks. The step's output gives an upload URL for raw 16 kHz PCM chunks and a transcript URL that streams partial and final text.
- `merge`: combines fields from earlier steps' outputs into one result.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens an exported union. It is purely additive: nothing that compiled before stops compiling, and there is no runtime change. Both types sit in the `CatalogStepTypesWithoutAGeneratedType` ledger until `@civitai/client` republishes with templates for them.
