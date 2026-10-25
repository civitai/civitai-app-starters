---
'@civitai/blocks-react': patch
---

`useResourceFile` docs: correct the retry guidance, and define `dev:mock`.

- `ResourceFileError` no longer calls `parse-failed` terminal. It is also the host's catch-all for a network error, a failed fetch, its 110 s deadline or a transient storage failure, so one retry is worth it.
- `unauthorized` now says what to do: offer sign-in with `useRequestSignIn()`. The page reloads signed in, the block re-inits, and the hook fetches again on mount.
- The retry example says `parse-failed` is worth at most one retry and must not join its unbounded `busy` / `rate-limited` loop, which would re-download up to 32 MB every 2 s.
- The README's "Only free, public versions are served" section now also says the owner can read their own non-public files and a version with downloads disabled, and that an archived or deleted model is `not-found` for everyone. The hook comment points there.
- The README now defines `dev:mock` once, under "In a dev harness": it is the mock harness, which a starter runs with `npm run dev:harness` (it is not a script name).
