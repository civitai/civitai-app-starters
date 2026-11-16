---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**Unlock a restricted workflow output in place.** `useOutputUnlock()` (`@civitai/blocks-react`) sends the new `REQUEST_OUTPUT_UNLOCK { workflowId, position }`; the host replies `OUTPUT_UNLOCK_RESULT { result }` once the viewer is done with its own dialog.

- **New types** (`@civitai/app-sdk/blocks`): `BlockOutputUnlockResult` (`{ outcome, snapshot?, message? }`) and `KnownBlockOutputUnlockOutcome` (`'unlocked' | 'not-restricted' | 'not-released' | 'refused' | 'linked-out' | 'dismissed' | 'unavailable'`, an open union).
- **What the host offers** is decided from the live workflow, never from the app. An output restricted for `'pool'` can be unlocked with yellow Buzz at the price the host shows. An unlock adds no author share and counts against no spend limit (the original generation's spend already counted); `'refused'` means the viewer's yellow Buzz is short. A `'ceiling'` or `'unrated'` output is never charged: the host links to the same app on civitai.red, at the current page, when that site could show it.
- **Transport:** `OUTPUT_UNLOCK_RESULT` is validated (an `error` string or a `result` with a string `outcome`) and its `result.snapshot` is projected like every other snapshot reply. `REQUEST_OUTPUT_UNLOCK` uses the human-interaction timeout.
- **Mock host:** answers the request as the host does. `generation.outputUnlock` decides a `'pool'` position: `'unlock'` (default; it stays unlocked), `'dismiss'`, `'insufficient'` (`'refused'`) or `'not-released'`. `generation.outputUnlockRestricted` decides a `'ceiling'` / `'unrated'` one: `'dismiss'` (default), `'link-out'` or `'settings'` (`'unavailable'`). A missing position, or a second open request for one position, answers `'unavailable'`. The live dev host answers `'unavailable'`: the unlock needs a signed-in civitai.com session.
- Needs a host with the unlock (civitai/civitai#9083); an older host has no handler, and the request times out.
