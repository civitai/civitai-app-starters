---
'@civitai/sdk': minor
---

`host.openImageUpload` — civitai's own upload modal, and the moderation verdict
that follows it. The frame never handles the bytes; the host takes the file
through the viewer's session and hands back what it stored.

Two modes, because the host has two:

- **A public image** resolves a `PendingImage` — the image exists and its author
  can see it, and `scan()` answers whether anyone else may. The host reaches
  that verdict after the upload has already resolved and pushes it separately,
  so `scan()` is the only way to learn it.
- **`{ purpose: 'generationSource' }`** resolves `{ url, width, height }`: a
  private img2img source the host stores UNSCANNED, because the orchestrator
  scans it when the workflow runs.

🔴 `scanned` is the only verdict that clears an image for anyone but its author.
`blocked` is the host refusing it and `error` is the host not answering —
neither is a pass, so branch on `scanned`, never on "not blocked". Nothing
becomes `scanned` without a readable image behind it, and a verdict this client
cannot read is an `error` rather than a silence, because a dropped verdict
leaves `scan()` waiting on a push the host has already sent.

Shape differences from `@civitai/blocks-react`'s `useImageUpload`, both
deliberate: there is one display mode rather than two, so no caller can hold an
image that looks moderated without having asked for the verdict; and `scan()`
carries no deadline of its own, matching the rest of this package — pass a
`signal` for the bound your app wants. A host that predates the asynchronous
flow replies with an already-moderated image, and that is read as the verdict it
is rather than waiting on a push such a host will never send.

The public surface this adds is `Host.openImageUpload` plus four types
(`PendingImage`, `ImageScanResult`, `UploadedImage`, `SourceImage`), each
reachable from that one signature. Nothing else.
