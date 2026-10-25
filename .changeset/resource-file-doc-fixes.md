---
'@civitai/blocks-react': patch
---

`useResourceFile` docs: correct the retry guidance, and define `dev:mock`.

- `ResourceFileError` no longer calls `parse-failed` terminal. It is also the host's catch-all for a network error, a failed fetch, its 110 s deadline or a transient storage failure, so one retry is worth it.
- `unauthorized` does not clear by itself. The hook refetches only when the ids change, not when the viewer does, so after the viewer signs in (`useRequestSignIn()`) call `refetch()`.
- The README's "Only free, public versions are served" section now also says the owner can read their own non-public files and a version with downloads disabled, and that an archived or deleted model is `not-found` for everyone. The hook comment points there.
- The README now defines `dev:mock` once, under "In a dev harness": it is the mock harness, which a starter runs with `npm run dev:harness` (it is not a script name).
