---
'@civitai/sdk': minor
---

**A moderator's review preview sees the app's errors.** When the host lists `blockErrors:v1` in `BLOCK_INIT.capabilities` (civitai.com does on its review preview), `initialize()` forwards uncaught errors, unhandled promise rejections and `console.error` calls to the host as non-fatal `BLOCK_ERROR`s, exactly as it already does in a dev-tunnel preview: the same `source`, `stack` and `at` fields, the same redaction, truncation, 10-second dedupe and 20-a-minute limit.

- The document store is unaffected: a review preview keeps the real routes. Only `storageMode: 'local-preview'` switches to the local store.
- `BlockSnapshot` gains an optional `errorReports: true`, set only when the exact string is listed.
- Every other host, and every production embed, sends nothing new.
