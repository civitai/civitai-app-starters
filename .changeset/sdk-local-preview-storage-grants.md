---
'@civitai/sdk': patch
---

`requestGrants` in a dev-tunnel preview no longer asks the host for the document-store scopes. When the host marks the frame `storageMode: 'local-preview'`, the in-tab local store serves `app.storage.collection(name)`, and a preview token never carries `apps:storage` or `apps:storage:publish`, so the host could only refuse them. That refusal took the rest of the request with it: `requestGrants(['ai:write:budgeted', 'apps:storage'])` resolved `false` even though the spend scope was grantable.

In a local preview those two scopes now count as held. A request for only them resolves `true` without contacting the host, and a mixed request asks only for the rest and resolves with the host's answer for those. Shared storage and the deprecated key/value scopes are still requested from the host, because they keep the real routes in a preview. Outside a local preview nothing changes. The token is unchanged, and so is what the server enforces.
