---
'@civitai/sdk': minor
---

**Server-side storage publish.**

- **`collection(to).publish({ from, keys, prune? })`** asks civitai.com to copy the viewer's own documents at `keys` (1 to 500) from a private collection into the shared collection `to`, authored by the viewer, in one transaction. Only new or changed documents are written; `skipped` reports `missing`, `not_author` and `hidden` keys; `prune` deletes the viewer's own copies whose key has no document in `from` (500 per call, `pruneIncomplete`); it is scoped by `from`, so with several private collections feeding one shared collection a prune from one deletes the others' copies. It spends its own budget (about 10 a day), never the shared write budget. **`collection(to).unpublish(keys)`** deletes the viewer's own copies in one transaction.
- **Older hosts:** civitai.com serves publish behind a per-app flag (civitai/civitai, draft). A host without it answers as an unknown route, which the client reports as the new LOCAL code **`publish_unavailable`** (404); fall back to per-document writes.
- A storage 429 already carries `details.retryAfter`, read by `StorageError.retryAfter`; the client never retries a refusal by itself.
- **Mock host:** `createFakeStorage` serves `publish` and `unpublish` only with `publish: true`, with the server's rules and budgets (each publish call also spends one private-write/delete token, as on the server). Off by default, as on civitai.com, where both answer as an unknown route (`publish_unavailable`).
