---
'@civitai/blocks-react': minor
---

**The transport snapshot carries `BLOCK_INIT.appData` and the token's `kind`, so `@civitai/sdk` built on this transport can use the app-data service.** `@civitai/sdk` 0.32 sends `app.storage` to the app-data service when the host puts `appData: { url, slug }` in `BLOCK_INIT`, and only while the frame holds a block token (`token.kind === 'block'`). An app that hands this package's transport to the SDK (`initialize({ transport })` reading `getSnapshot()`) lost both fields, so its storage always used the site's routes.

- `BlockSnapshot.appData` is set only for the exact `{ url, slug }` shape with a plain `https:` URL and a slug in the service's grammar, which is the check `@civitai/sdk` applies. Any other value leaves the key off. Nothing in this package acts on it.
- `appData` is not attached when the host marks the frame `storageMode: 'local-preview'`, so a local preview still wins over the service, as it does in `@civitai/sdk`.
- `BlockSnapshot.token.kind` is set when the host sends `'block'` or `'oauth'`, at init and on every token refresh. A refreshed token without a recognised `kind` has none, so an earlier `kind` is never kept. civitai.com's host already sends `kind`, so **`useBlockContext().token`, `useBlockToken()` and the snapshot's token now carry a `kind` key**. Code that serialises a token, or compares tokens deeply (a snapshot test or `toEqual` against a literal, for example), will see the new key.
- `@civitai/sdk` built on this transport can now tell which kind of token it holds. Besides service mode, three existing SDK branches that depend on the kind now apply to these apps; before, none of them ran here:
  - A site API `401`/`403` outside `blocks/*` under a block token gets the SDK's block-token advice appended to its message (`explainApiRefusal`).
  - A workflow `401` under an OAuth token gets the SDK's OAuth advice appended (`explainWorkflowRefusal`).
  - **A behaviour change, not just a message:** `app.orchestration` calls made while the frame holds a block token are now refused by the SDK BEFORE any request, with a `CivitaiError` explaining the OAuth opt-in. Before, the request went out and the orchestrator answered `401` (`ApiError`). The orchestrator does not accept a block token, so these calls failed either way. Only how they fail changes.
- New exported types: `AppDataService`, `SnapshotToken` (`BlockToken` plus the optional `kind`) and `SnapshotTokenKind`.
