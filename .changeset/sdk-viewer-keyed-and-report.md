---
'@civitai/sdk': minor
---

**Viewer-keyed documents and the report API.** Both are additive; nothing existing changes.

- **Viewer-keyed collections** (civitai/civitai#10216): a shared `write: "own"` collection that declares `keyedBy: "viewer"` (one document per viewer) or `"parent+viewer"` (one per viewer per parent key) gets three new collection methods, at `…/:collection/@me[/:parent]`, whose keys the server derives from the signed-in viewer:
  - `getMine(parent?)` → the viewer's document or `null`.
  - `putMine(data, { parent?, ifVersion? })` → exactly a `put` at the derived key (`ifVersion: 0`: only if absent).
  - `deleteMine({ parent?, ifVersion? })` → `{ deleted }`.
  - `parentOf(key)` reads the parent back from a `<parent>:<digest>` key (`null` otherwise); it never computes a key.
  - A `parent` is sent encoded and judged by the server (mode first, then its grammar: `invalid_parent`); only `''`, `.` and `..`, which no URL path can carry, are refused before sending with that code and reason.
  - `getMine` reads a 404 as "none yet" only on the server's exact `not_found` "document not found"; any other 404 rejects.
  - **Requires the civitai.com release that enables `keyedBy` for submit (civitai/civitai#10246).** Until it is live, `civitai app submit` refuses a manifest declaring `keyedBy`; the fake and the local preview already accept it.
  - **New:** `storageViewerKeyedRefusal(error)` types the new refusals by reason: `viewer_keyed`, `not_viewer_keyed`, `parent_required`, `parent_not_allowed`, `invalid_parent` (400), `viewer_keyed_closed` (403 `write_policy`), `viewer_keys_unconfigured` (503 `service_unavailable`) and `sign_in_required` (401, on a `…Mine` call).
  - `info()`'s `StorageCollectionInfo` gains optional `keyedBy` and `open`. New types: `StorageKeyedBy`, `ViewerKeyedOptions`, `StorageViewerKeyedRefusal`, `StorageViewerKeyedRefusalReason`.
- **`app.moderation.report({ collection, key, from? })`** (civitai/civitai#10215): `POST /api/v1/blocks/moderation/reports` → `{ reported: true }`, idempotent, never a count. A host that does not serve it (an older release, or the per-app flag off) rejects with the new LOCAL code `report_unavailable` (404); a document that is not there stays `not_found`. A `{ from: undefined }`, and a `key` outside the server's key grammar (so it spends no report budget), are refused before sending. New types: `ModerationClient`, `StorageReportRequest`.
- **Fake and local preview:** `createFakeStorage` serves `@me` with the server's rules and order (one document per viewer per parent, an opaque derived key, moderation of the parent and never the key), and the report API with `reports: true` (off by default, as on civitai.com). `viewerKeyedClosed` and `viewerKeysUnconfigured` reach the two switch refusals. A fake session has `moderation` beside `storage`. A dev-tunnel local preview serves both in the tab, sending nothing.
