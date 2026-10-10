---
'@civitai/blocks-react': patch
---

**Docs only: the `useUploadImageBytes()` reference no longer says to wait for a host release, and states what an uploaded image can and cannot do.** The README section and the hook's JSDoc still told authors not to ship a block that relies on the hook until the host change behind it was merged and deployed. That change is in production, so the warning is removed. No code changes.

The README section now also states, as production rules:

- Generation metadata embedded in the uploaded file is not read, so the posted image has no generation details.
- Each uploaded image goes into exactly one post.
- An uploaded image never appears in `useGatedImages()` results.
- A post holds at most 20 images and names at most 10 sources.
- Posting from apps is still being rolled out, so `posting from apps is not enabled` is an ordinary refusal to handle, and it can arrive from `upload` as well as from `createPost()`.
- Creating the post needs an account with a verified email or a linked sign-in provider.
- Server-side limits apply beyond the host's per-page window; a `busy` reply or a rate-limit error means wait and retry.
