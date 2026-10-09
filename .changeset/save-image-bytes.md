---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**`useSaveImage()` can save a file the block produced in the tab (#583).** `saveImage({ bytes, filename? })` hands an `ArrayBuffer` to the host, which downloads it from its unsandboxed top frame. This is the sanctioned way for an in-tab tool, such as a metadata healer or an exporter, to deliver a file. A blob-anchor `<a download>` does nothing in a block, because its sandbox lacks `allow-downloads` and the validator refuses that token for unverified blocks.

- **Page apps only.**
- **The host classifies by content.** PNG, WebP and JPEG are recognised by magic bytes. Anything else must be valid UTF-8 with no NUL byte: it is saved as JSON when it parses and `filename` ends `.json` (case-insensitive) after the host replaces each `?` and `#` with `_`, and as text/plain otherwise. Everything else is refused with `file type is not allowed`. An empty buffer is refused with `invalid save-image request`. The saved extension is forced from the classified type.
- **The cap is 50 MiB.** The hook refuses a larger buffer before sending it, with the host's error `file exceeds the maximum save size`. That is the hook's only client-side refusal: every other input is forwarded and judged by the host, which replies `invalid save-image request` to a request that is not exactly one of `url` / `imageId` / `bytes`, or whose `bytes` is not a non-empty `ArrayBuffer` (pass `await blob.arrayBuffer()`, not the `Blob` or a `Uint8Array`). The buffer is copied across `postMessage`, never transferred.
- 🔴 **A host that predates this variant replies `invalid save-image request`.** Until the civitai.com host ships it, `saveImage({ bytes })` rejects with that string in production.
- `@civitai/app-sdk`: the `SAVE_IMAGE` payload type gains `bytes?: ArrayBuffer`.
- **Mock host (`createMockHost` / `Harness`, `@civitai/blocks-react/testing`):** it applies the same request-shape gate and content classification to `bytes`, including the empty-buffer refusal. It also gains a `saveImageError` knob (forced refusal; live-tunable via `setScenario`, and `undefined` clears it) and an `onSaveBytes` callback reporting what would have been downloaded (the classified type, the filename with its forced extension, and a copy of the bytes). Its invalid-request error is now the host's string `invalid save-image request`, where it used to be `INVALID_REQUEST`. A `SAVE_IMAGE` without a routable `requestId` is now dropped, as its sibling handlers already did. The mock does not model the page-only refusal or the host's `busy` concurrency cap; force `busy` with `saveImageError`.
- `dev:live` still refuses every `SAVE_IMAGE`, the `bytes` variant included.
