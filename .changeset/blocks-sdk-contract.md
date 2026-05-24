---
'@civitai/app-sdk': minor
---

Add `@civitai/app-sdk/blocks` subpath: framework-agnostic contract for Civitai App Blocks.

- `defineBlock(config)` validates a `BlockManifestV1` at startup and returns it unchanged. Enforces the immutable-blockId pattern, integer `iframe.minHeight` / `iframe.maxHeight` (matching the JSON schema), blocks `allow-same-origin` / `allow-top-navigation` sandbox flags (including the `-by-user-activation` and `-to-custom-protocols` variants), requires HTTPS iframe src (with a localhost escape hatch for dev — `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`), and rejects PascalCase scope strings with a pointed error message.
- `BLOCK_SCOPES` / `BlockScope` / `BLOCK_SCOPE_PATTERN` — colon-separated lowercase block-scope strings, distinct from the OAuth `TokenScope` bitmask.
- Typed postMessage protocol (`ParentToBlockMessage`, `BlockToParentMessage`, `BlockInitPayload`, `isMessage()` narrowing helper, `WrappedToken` shared by `BLOCK_INIT` / `TOKEN_REFRESH` / `TOKEN_REFRESH_RESPONSE`) for hosts and block runtimes to share. `TOKEN_REFRESH` is the host-pushed rotation message (no `requestId`); `TOKEN_REFRESH_RESPONSE` is the reply to a block-initiated `REQUEST_TOKEN` (optional `requestId`). Both carry the same wrapped-token shape.
- Manifest + context types: `BlockManifestV1`, `BlockContext`, `ModelSlotContext` (the concrete narrowing for `model.sidebar_top` / `.below_images` / `.actions_extra`), `BlockToken`, `BlockSettings`, `ViewerInfo` (signed-in viewer only — `BlockInitPayload.viewer` is `ViewerInfo | null` so anon is explicit), `Theme` (`'light' | 'dark'`), `BlockWorkflowSnapshot`, etc.
- Aligned with civitai/civitai's `src/components/AppBlocks/types.ts`: same `BLOCK_INIT` field layout, same scope strings, same viewer/theme shapes.
- `schemas/app-block/v1.json` JSON Schema (draft-07) ships with the package and is also exported via the `./schemas/app-block/v1.json` subpath for offline validation.

React hooks and the iframe transport ship in a follow-up package — this subpath stays runtime-agnostic.
