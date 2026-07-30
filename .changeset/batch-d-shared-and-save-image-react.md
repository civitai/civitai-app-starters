---
'@civitai/blocks-react': minor
---

Surface the App Blocks Batch-D platform seams as hooks: `useSharedStorage().get()` / `.report()` / per-item `viewerVoted`, and a new `useSaveImage()`.

- **`useSharedStorage().get(key)`** — resolve ONE shared entry by key (`SharedListItem | null`), for a `?g=<key>` deep-link to any item, not just the first page. Respects the same per-viewer visibility as `list` (a hidden/withdrawn row resolves to `null`).
- **`useSharedStorage().report(key, reason?)`** — report a posted entry for moderator review. Trust-gated + rate-limited server-side (same `apps:storage:shared:write` boundary as `append`).
- **`SharedListItem.viewerVoted: boolean`** — hydrate a vote button's state on load instead of guessing (fixes the "double-click to unvote" bug). `list()` and `get()` both populate it; it defaults to `false` when talking to an older host that doesn't send the field, so a new block on an old host degrades to today's behavior. Anonymous viewers are always `false`.
- **`useSaveImage()`** — `saveImage({ url, filename? })` for the block's OWN output (origin-allowlisted host-side to the civitai image/blob CDN) or `saveImage({ imageId, filename? })` for a cross-user grid image (routed through the gated per-viewer read, so a withheld image can't be saved). The host does the blob fetch + download in its unsandboxed top frame — the only way a sandboxed block (no `allow-downloads`) can save a paid output.

Adds transport-boundary validators for the three new `*_RESULT` replies (a malformed reply is dropped rather than resolving a promise with corrupt data), and the mock host now serves `SHARED_GET` / `SHARED_REPORT` / `SAVE_IMAGE` for local dev. All additive; existing hooks and blocks are unaffected.
