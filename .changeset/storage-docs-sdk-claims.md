---
'@civitai/sdk': patch
---

Docs only. The legacy shared store's minimum-trust gate no longer lists a paid tier, which the server does not check; it lists account age, completed onboarding, a verified email or linked OAuth account, and not being banned or muted (README, `BREAKING.md`, and the `SharedStorageClient` doc comment). The `app.sharedStorage.list` example no longer filters on `prefix: 'deck:'`: `append` mints every key as a ULID, so a prefix you choose matches none of the rows it creates. The README and the `SharedListQuery.prefix` doc comment now say so.
