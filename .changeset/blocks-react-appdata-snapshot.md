---
'@civitai/blocks-react': minor
---

**The transport snapshot carries `BLOCK_INIT.appData` and the token's `kind`, so `@civitai/sdk` built on this transport can use the app-data service.** `@civitai/sdk` 0.32 sends `app.storage` to the app-data service when the host puts `appData: { url, slug }` in `BLOCK_INIT`, and only while the frame holds a block token (`token.kind === 'block'`). An app that hands this package's transport to the SDK (`initialize({ transport })` reading `getSnapshot()`) lost both fields, so its storage always used the site's routes.

- `BlockSnapshot.appData` is set only for the exact `{ url, slug }` shape with a plain `https:` URL and a slug in the service's grammar, which is the check `@civitai/sdk` applies. Any other value leaves the key off. Nothing in this package acts on it.
- `BlockSnapshot.token.kind` is set when the host sends `'block'` or `'oauth'`, at init and on every token refresh. Any other value leaves it off.
- New exported types: `AppDataService`, `SnapshotToken` (`BlockToken` plus the optional `kind`) and `SnapshotTokenKind`.
