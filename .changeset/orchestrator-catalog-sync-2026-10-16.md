---
'@civitai/app-sdk': minor
---

Catalog sync: the orchestrator spec accepts 4 entries the SDK catalogs did not list.

- `IMAGE_GEN_ENGINES`: add `krea3` — Krea 3 text-to-image, or an edit of up to six reference images, at 1K or 2K.
- `WORKFLOW_STEP_TYPES`: add `archiveExtraction` — unpack a zip / tar / tar.gz archive into its entries, with a media-type filter and an entry cap.
- `WORKFLOW_STEP_TYPES`: add `audioModeration` — transcribe the lyrics in a media file's audio and flag sexualized minors.
- `WORKFLOW_STEP_TYPES`: add `multimodalEmbedding` — normalized embeddings of text, images or short videos (`wemm-2b`, 64–2048 dimensions).

The three new step types have no generated template in the pinned `@civitai/client` yet, so `WorkflowStepTemplateFor<…>` is a compile error for each of them, as for the other entries of that gap.

`WORKFLOW_STEP_TYPES` / `IMAGE_GEN_ENGINES` are hand-maintained mirrors of the `discriminator.mapping`s in `https://orchestration.civitai.com/openapi/v2-consumers.json`, which moves per orchestrator build — so they drift without anyone touching this repo. `krea3` was read on 2026-10-16, the three step types on 2026-10-24.

**Why `minor`.** `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`, so this widens an exported union. Purely additive: nothing that compiled before stops compiling, and there is no runtime behaviour change.
