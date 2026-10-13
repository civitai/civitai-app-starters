---
'@civitai/blocks-react': patch
---

**`dev:live` no longer puts the dev block token in request URLs.**

The live dev host (`createLiveHost`, behind `dev:live`) now sends every tRPC query as POST, with the input in the request body. Every query it sends carries the block token: `apps.storage.get`, `apps.storage.list`, `apps.storage.getQuota`, `apps.shared.list`, `apps.shared.get`, `apps.shared.getCount` and `apps.shared.getCounts`. Before, these went out as GET with the input, token included, in `?input=`. They are still queries on the server; this is tRPC's query method override, which civitai.com already accepts. Mutation requests are unchanged, and nothing changes for a block: every bridge message resolves exactly as before.
