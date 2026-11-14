---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': patch
---

**`usePersistGenerationSource()` saves one of the app's own finished outputs as a private, scanned generation source, with no confirm dialog.** `const { persist, isPending, error } = usePersistGenerationSource(); const src = await persist({ workflowId, imageIndex })` resolves with `{ url, width, height, imageId, ready }`; `url` / `width` / `height` go into a `sourceImages` entry of the next generation.

- 🔴 **RELEASE HOLD: must not be released before the civitai host change that answers `PERSIST_GENERATION_SOURCE` ships.** An older host does not answer the message, so `persist()` waits out its 45 s timeout and then rejects with `RequestTimeoutError`.
- The image is private to the viewer and is not on the app's shared grid. The host waits up to about 30 s for the scan: `ready: false` means it is still pending, and a generation that uses the source is refused with the `source-scan-pending` error code until it finishes. Full-page app hosts only: an iframe/slot host replies with an error, which `persist()` rejects with.
- `@civitai/app-sdk/blocks`: the `PERSIST_GENERATION_SOURCE { requestId, workflowId, imageIndex }` → `GENERATION_SOURCE_PERSISTED { requestId, result?, error? }` message pair, added to `BLOCK_TO_PARENT_MESSAGE_TYPES`, and the types `BlockPersistGenerationSourceRequest` and `BlockPersistedGenerationSource` (the pinned `./blocks` export count moves 229 -> 231). Use this `@civitai/app-sdk` release or later with this `@civitai/blocks-react` release.
- `@civitai/blocks-react`: `usePersistGenerationSource()`. The request waits up to 45 s (a `'protocol'` request, no person in the loop). A malformed reply rejects with `the host sent a malformed reply to PERSIST_GENERATION_SOURCE` instead of being dropped, so `persist()` never hangs on a reply the host sent. Mock host: `persistedGenerationSource` (the canned reply, `ready: true` by default; pass one with `ready: false` to simulate a pending scan) and `persistGenerationSourceError`. `dev:live` refuses it with an error naming the mock host options.
- `@civitai/sdk`: the host reply ledger lists `PERSIST_GENERATION_SOURCE`, so `BlockTransport.request()` settles it with `{ result }` instead of refusing it. No typed `app.host` wrapper.
