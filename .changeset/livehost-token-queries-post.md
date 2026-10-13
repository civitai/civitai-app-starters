---
'@civitai/blocks-react': patch
---

**`dev:live` no longer puts the dev block token in request URLs.**

The live dev host (`createLiveHost`, behind `dev:live`) now sends the seven tRPC queries whose input carries the block token as POST, with the input in the request body: `apps.storage.get`, `apps.storage.list`, `apps.storage.getQuota`, `apps.shared.list`, `apps.shared.get`, `apps.shared.getCount` and `apps.shared.getCounts`. Before, they went out as GET with the input, token included, in `?input=`. They are still queries on the server; this is tRPC's query method override, which civitai.com already accepts. Mutations are unchanged, and nothing changes for a block: every bridge message resolves exactly as before.
