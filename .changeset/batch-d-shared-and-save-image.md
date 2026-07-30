---
'@civitai/app-sdk': minor
---

Add the App Blocks Batch-D block↔host messages: `SHARED_GET` / `SHARED_GET_RESULT`, `SHARED_REPORT` / `SHARED_REPORT_RESULT`, and `SAVE_IMAGE` / `SAVE_IMAGE_RESULT`, plus an additive `viewerVoted?: boolean` on `SharedStorageItemWire`.

- **`SHARED_GET { key }` → `SHARED_GET_RESULT { item: SharedStorageItemWire | null }`** — single-row fetch-by-key, the companion to `SHARED_LIST`'s paged read so a `?g=<key>` deep-link to an item past the first page resolves. A missing / moderator-hidden row comes back as `item: null` (never leaked). The item carries the same shape as one list item, including `count` + `viewerVoted`.
- **`SHARED_REPORT { key, reason? }` → `SHARED_REPORT_RESULT { ok, error? }`** — report a posted shared-board entry for moderator review (the `apps.shared.report` server procedure already existed; this is the postMessage seam). Same `{ ok, error? }` reply convention as `SHARED_WITHDRAW_RESULT` (the error path carries `ok: false`).
- **`SAVE_IMAGE` → `SAVE_IMAGE_RESULT { ok, error? }`** — ask the host to DOWNLOAD an image the block already displays (a sandboxed opaque-origin block has no `allow-downloads`, so it can otherwise only copy a URL). Two mutually-exclusive variants: `{ url }` for the block's own output (origin-allowlisted host-side to the civitai image/blob CDN — never an arbitrary host) and `{ imageId }` for a cross-user grid image (routed through the same per-viewer gated read as `GET_IMAGES_BY_IDS`, so a withheld image can't be saved). Optional `filename` (host-sanitized).
- **`SharedStorageItemWire.viewerVoted`** is OPTIONAL on the wire so a host that predates it still typechecks; consumers default a missing value to `false`.

All additive — old blocks never send the new messages, and the new field is optional. Host handlers land ahead of this publish (the host↔SDK parity gate is one-directional).
