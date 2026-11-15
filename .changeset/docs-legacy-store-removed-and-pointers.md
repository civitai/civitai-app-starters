---
'@civitai/blocks-react': patch
'@civitai/app-sdk': patch
'@civitai/sdk': patch
'@civitai/components-react': patch
'@civitai/components-chat': patch
---

Docs: the published READMEs stop teaching the legacy stores civitai.com removed on 2026-11-10, and hand-copied lists point at their sources instead.

- `@civitai/blocks-react`: the `useBuzzWorkflow()` return list now includes `watch` and `cancel`. The Examples list and the version-compatibility table (which stopped at `0.78.x`) are replaced by pointers to `starters/examples/`, the package's `peerDependencies` and `CHANGELOG.md`.
- `@civitai/app-sdk`: the README points at `src/blocks/messages.ts` for the message unions instead of a hand-copied list, and names the document store for durable data.
- `@civitai/sdk`: the README's "Both give you" table lists `app.storage`, `app.sharedStorage` and `app.subListings`. `BREAKING.md` no longer quotes a hook count or a `withBlockScope` route count.
- `@civitai/components-react`: the README names `CivitaiWorkflowButton`, the second binding kept out of the barrel.
- `@civitai/components-chat`: the README says its property table is not the full list and points at `CivitaiChat`'s `static properties`.
