---
'@civitai/app-sdk': patch
---

Docs: the `buildImageGenBody` example passes a hosted image URL instead of a `data:` URI, and `WorkflowBodyPassThroughStep.input` says the block host refuses inline media (a media data URI or long raw base64) — upload with `useImageUpload({ purpose: 'generationSource' })` or pick with `useImagePicker()` and pass the `url`.
