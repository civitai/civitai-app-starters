---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': patch
---

**`GET_RESOURCE_FILE`: read a resource file's parsed JSON (a workflow's graphs) over the bridge** — the SDK half of civitai/civitai-app-starters#664, phase 2.

- `@civitai/app-sdk/blocks`: the `GET_RESOURCE_FILE { requestId, modelVersionId, fileId? }` → `RESOURCE_FILE_RESULT { requestId, file } | { requestId, error }` message pair, and the types `BlockResourceFile` (`{ meta, entries, truncated }`), `BlockResourceFileMeta`, `BlockResourceFileEntry` (`{ path, format, graph }`), `BlockResourceFileEntryFormat` (`'ui' | 'api' | 'unknown'`) and `BlockResourceFileErrorCode`, a closed set: `not-found`, `forbidden`, `unauthorized`, `too-large`, `parse-failed`, `busy`, `rate-limited`.
- `@civitai/blocks-react`: `useResourceFile(modelVersionId, fileId?)` → `{ file, loading, error, refetch }`, with `ResourceFileError` (`.code` from the closed set). It waits up to 120 s for the host (which downloads and unzips the file), and changing either id resets `file` and `error` before the new fetch. The reply validator drops an unknown code or a malformed file. Mock host: `resourceFile` (the canned reply; by default one UI-format graph) and `resourceFileError` (force a code; `setScenario({ resourceFileError: undefined })` clears it). `dev:live` refuses it with `parse-failed`.
- `@civitai/sdk`: the host reply ledger lists `GET_RESOURCE_FILE`, so `BlockTransport.request()` settles it with `{ file }` instead of refusing it. No typed `app.host` wrapper yet.

No block scope and no manifest change. Full-page app hosts only: the model-page slot does not answer it, and `dev:live` does not serve it. Only free, public versions are served — an unpublished draft or an early-access or paid version answers `not-found`, even for a viewer who bought it.
