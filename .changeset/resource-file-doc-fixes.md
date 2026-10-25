---
'@civitai/blocks-react': patch
---

`useResourceFile` docs: correct the retry guidance and the dev command.

- `ResourceFileError` no longer calls `parse-failed` terminal. It is also the host's catch-all for a network error, a failed fetch, its 110 s deadline or a transient storage failure, so one retry is worth it.
- `unauthorized` does not clear by itself. The hook refetches only when the ids change, not when the viewer does, so after the viewer signs in (`useRequestSignIn()`) call `refetch()`.
- The docs and the `dev:live` refusal log pointed at `dev:mock`, which no starter defines. They now name the mock host (`npm run dev:harness`).
- The hook comment now says what the owner can read: their own non-public files and their published early-access, downloads-disabled, POI or non-public-availability versions. A draft, an archived model or a deleted model is `not-found` for everyone, the owner included. The README now names the non-public-files, downloads-disabled and archived/deleted cases as well.
