---
'@civitai/sdk': minor
'@civitai/app-sdk': patch
---

`getTransport().request(type)` now settles for every request the host answers,
and refuses at once what it never answers.

- The reply ledger is generated from the host's inventory (`snapshots/host-messages.json`,
  now carrying each request's reply name, framing and success keys) and covers all 43
  host request types instead of 6. `request('GET_VIEWER')` resolves `{ viewer }` rather
  than hanging; the `APP_STORAGE_*` and `SHARED_*` replies resolve with their fields
  rather than rejecting `malformed` on success; `CANCEL_APP_WORKFLOW`'s failure keeps
  the host's message.
- A type the host does not answer rejects immediately with a `BridgeError` of code
  `invalid` instead of waiting forever. A fire-and-forget message says to use `notify()`,
  and where BREAKING.md names a replacement the message names it (e.g. `GET_VIEWER` →
  `app.site.get('blocks/me')`).
- `SCOPES` (and `Scope`) gain the scopes the host now grants: `apps:storage`,
  `apps:storage:publish`, `apps:store:items:write`, `goods:read:self` and
  `goods:purchase:self`.
- `BlockSnapshot.viewer`'s doc pointed at `/me`, which refuses a block token; it now
  says `app.site.get('blocks/me')`.

`@civitai/app-sdk`: `ViewerInfo.id`/`username`'s deprecation notes name
`app.site.get('blocks/me')` for blocks outside React, not only `useViewer()`.
