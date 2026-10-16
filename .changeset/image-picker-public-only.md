---
'@civitai/app-sdk': minor
---

`OPEN_IMAGE_PICKER` gains an opt-in `publicOnly?: boolean`. With `publicOnly: true` the host's `'posted'` library offers only images whose post is published and not `Private`, so the pick is usable where the store requires a public image, such as an App Store sub-listing card image (`imageId` on `POST /api/v1/blocks/sub-listings/upsert`, `app.subListings.upsert` in `@civitai/sdk`). The `'generated'` library is unaffected. Absent or `false` keeps today's behaviour; an app picking a private input (a generation source) leaves it off.

Compatibility: a host that predates the field ignores it and still offers `Private`-post images, so an app that sets it must still handle the store's `image_not_public` refusal.
