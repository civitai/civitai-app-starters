---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**Share a viewer-picked upload with your app's other viewers.** `useImageUpload({ share: true })` (display uploads, blocking or `asyncScan`) sends `share: true` on `OPEN_IMAGE_UPLOAD`. The host tells the viewer in its upload dialog, before they pick a file, that the image will be visible to the app's other viewers once Civitai has scanned it. The server then records your app, from the verified block token, on the image. Your app's gated image read (`useGatedImages`) returns it to other viewers once it is scanned, clamped to each viewer's browsing level. Without `share` (the default) nothing changes: the upload stays private to the uploader, and the message is byte-identical to before. `share` is ignored for `generationSource` and `trainingData`. A host that predates the field ignores it, so the upload is not shared there.
