---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**`useSaveImage()` can save a file the block produced in the tab (#583).** `saveImage({ bytes, filename?, mimeType? })` hands an `ArrayBuffer` to the host, which downloads it from its unsandboxed top frame. This is the sanctioned way for an in-tab tool, such as a metadata healer or an exporter, to deliver a file. A blob-anchor `<a download>` does nothing in a block, because its sandbox lacks `allow-downloads` and the validator refuses that token for unverified blocks.

- **Page apps only.**
- **The host classifies by content and never trusts `mimeType` or `filename`.** PNG, WebP and JPEG are recognised by magic bytes. Anything else must be valid UTF-8 with no NUL byte: it is saved as JSON when it parses and the hint (`mimeType: 'application/json'` or a `.json` filename) says json, and as text/plain otherwise. Everything else is refused with `file type is not allowed`. The saved extension is forced from the classified type.
- **The cap is `SAVE_BYTES_MAX_BYTES` (50 MiB),** newly exported from `@civitai/app-sdk/blocks`. The hook refuses a larger buffer before sending it, with the host's error `file exceeds the maximum save size`.
- **The hook now refuses some inputs before sending, with the host's own error `invalid save-image request`:** anything that is not exactly one of `url` / `imageId` / `bytes`, and a `bytes` that is not an `ArrayBuffer` (pass `await blob.arrayBuffer()`, not the `Blob` or a `Uint8Array`). The buffer is copied across `postMessage`, never transferred.
- 🔴 **A host that predates this variant replies `invalid save-image request`.** Until the civitai.com host ships it, `saveImage({ bytes })` rejects with that string in production.
- `@civitai/app-sdk`: the `SAVE_IMAGE` payload type gains `bytes?: ArrayBuffer` and `mimeType?: string`.
- **Mock host (`createMockHost` / `Harness`, `@civitai/blocks-react/testing`):** it applies the same request-shape gate and content classification to `bytes`. It also gains a `saveImageError` knob (forced refusal; live-tunable via `setScenario`, and `undefined` clears it) and an `onSaveBytes` callback reporting what would have been downloaded. Its invalid-request error is now the host's string `invalid save-image request`, where it used to be `INVALID_REQUEST`. A `SAVE_IMAGE` without a routable `requestId` is now dropped, as its sibling handlers already did. The mock does not model the page-only refusal or the host's `busy` concurrency cap; force `busy` with `saveImageError`.
- `dev:live` still refuses every `SAVE_IMAGE`, the `bytes` variant included.
- The `@civitai/app-sdk` peer floor rises to the release that first exports `SAVE_BYTES_MAX_BYTES`.
