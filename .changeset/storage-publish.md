---
'@civitai/sdk': minor
---

**Server-side storage publish, and a visible `retryAfter`.**

- **`collection(to).publish({ from, keys, prune?, prunePrefix? })`** asks civitai.com to copy the viewer's own documents at `keys` (1 to 500) from a private collection into the shared collection `to`, authored by the viewer, in one transaction. Only new or changed documents are written; `skipped` reports `missing`, `not_author` and `hidden` keys; `prune` deletes the viewer's own copies whose private document is gone (500 per call, `pruneIncomplete`). It spends its own budget (about 10 a day), never the shared write budget. **`collection(to).unpublish(keys)`** deletes the viewer's own copies in one transaction.
- **Older hosts:** civitai.com serves publish behind a per-app flag (civitai/civitai, draft). A host without it answers as an unknown route, which the client reports as the new LOCAL code **`publish_unavailable`** (404); fall back to per-document writes.
- **`StorageError.retryAfter`** now also reads the envelope's `rateLimit.retryAfterSeconds` when `details.retryAfter` is absent. The client still never retries a refusal by itself.
- **Mock host:** `createFakeStorage` serves `publish` and `unpublish` with the server's rules and budget; `publish: false` models a host without them.
