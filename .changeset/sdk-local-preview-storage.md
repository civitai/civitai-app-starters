---
"@civitai/sdk": minor
"@civitai/app-sdk": minor
---

A dev-tunnel preview's document store is local to the tab (civitai/civitai-app-starters#710).

`@civitai/sdk`: when the host marks the frame `storageMode: 'local-preview'` in `BLOCK_INIT`, `initialize()` serves `app.storage.collection(name)` and `app.storage.info()` from an in-memory store (`createFakeStorage`, loaded with a dynamic `import()`) that enforces the LOCAL manifest's declarations, and sends no request to `blocks/storage/*`. The manifest reaches the SDK only from `blockManifestPlugin()` on the Vite dev server; without it, every document-store call rejects `local_preview_no_manifest` (404, not retryable, nothing sent). New: `app.storage.mode` (`'remote' | 'local-preview'`), the `StorageMode` type, and the local error codes `local_preview_no_manifest`, `local_preview_invalid_manifest` and `local_preview_unavailable` (all 404, not retryable). Model-version ownership (`ownedModelVersions`) is not checked locally; the server checks it. The mode switches only on the host's exact signal, never on token scopes. Without it, a real route's `insufficient_scope` now carries a hint after the server's message (declare `apps:storage`; granted once approved; previews are local when the host marks them). The deprecated key/value stores and `@civitai/blocks-react`'s storage hooks are unchanged and keep the real routes.

`@civitai/app-sdk`: `blockManifestPlugin()` exposes the manifest's `scopes` and `storage` to `@civitai/sdk` on the dev server only (a `<script>` at the end of `index.html`'s `<head>`; never in a build). `BlockInitPayload` gains the optional `storageMode?: 'local-preview'`.
