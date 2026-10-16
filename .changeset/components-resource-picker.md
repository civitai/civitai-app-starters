---
'@civitai/components': minor
---

Add `<civitai-resource-picker>` (`@civitai/components/civitai-resource-picker`, `…/define`): a modal that lets the viewer pick one version of a published resource from the Civitai catalog — their own (`owner="mine"`) or anyone's — with search, a version select (newest first) and badges on gated versions.

- Results come from a pluggable `source` (`{ search(params, signal) }`). Two ship with it: `blockTokenSource({ origin, getToken, fetch? })`, plain `fetch` against `GET /api/v1/blocks/models` with a raw block token, and `appClientSource(app)` over an `@civitai/sdk` `AppClient`. Neither ever falls back to the public `/api/v1/models`.
- A `mine` search is shown only when the server echoes `metadata.owner: 'mine'`; any other answer (including none, from a server that predates the parameter) is an error, never a list.
- `pick` carries `{ modelId, modelVersionId, name, versionName, creatorUsername, baseModel, earlyAccessDeadline?, access, owner }`; `dismiss` fires on close without a pick; `show()` resolves with the pick or `null`. `owner` is a UX hint, never proof of ownership.
- `access` reads the server's `paidAccess` gate: a timed gate is `early-access` (badge "Early access until …"), a permanent one `paid`.
- Debounced search, aborts superseded searches and drops late answers, retries `429`/`503` after `Retry-After` (twice, then "Try again").
- Like the other viewer-bound elements it is in no `register` entry; import its `/define`.
