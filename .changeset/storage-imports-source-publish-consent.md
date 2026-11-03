---
'@civitai/sdk': minor
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Publish consent in an import's source (civitai/civitai#7586). A create, put, counter, mark or unmark through `app.storage.collection(name, { from })` into one of the source's SHARED collections needs the viewer's `apps:storage:publish` grant IN THE SOURCE APP. Needs the civitai.com release that serves imports and this prompt.

`@civitai/sdk`: when the source refuses such a write `consent_required` with `details: { scope: 'apps:storage:publish', from }`, `app.storage` asks the host once (`REQUEST_CONSENT { scopes: ['apps:storage:publish'], from }`) and sends the same call once more on the next token refresh — the grant is the source's, so the token's scopes do not change. "Not now" (after 60 s), `CONSENT_UNAVAILABLE` and a second refusal reject with the original refusal; a caller abort during the wait rejects with the abort. A delete never asks. `GrantOptions` gains `from`, so `app.requestGrants(['apps:storage:publish'], { from })` asks for it directly; any other scopes with `from` resolve `false` without asking, as does a local preview or a sign-in session. `DocumentStorageOptions` gains `requestGrants`. `createFakeStorage` gains `requestGrants`, the host's prompt: `true` records the grant in that source.

`@civitai/app-sdk`: the `REQUEST_CONSENT` payload carries `from?: string`.

`@civitai/blocks-react`: `useRequestConsent()` accepts `from`; the mock and live dev hosts answer a `from` request with `CONSENT_UNAVAILABLE` (`ungrantable`, `['apps:storage:publish']`), since neither has another app to grant it in.
