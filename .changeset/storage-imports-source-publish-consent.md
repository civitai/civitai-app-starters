---
'@civitai/sdk': minor
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Publish consent in an import's source (civitai/civitai#7586). A create, put, counter, mark or unmark through `app.storage.collection(name, { from })` into one of the source's SHARED collections needs the viewer's `apps:storage:publish` grant IN THE SOURCE APP. Needs the civitai.com release that serves imports and this prompt.

`@civitai/sdk`: when the source refuses such a write `consent_required` with `details: { scope: 'apps:storage:publish', from }`, `app.storage` asks the host once (`REQUEST_CONSENT { scopes: ['apps:storage:publish'], from }`) and sends the same call once more on the next host-pushed `TOKEN_REFRESH` — the grant is the source's, so the token's scopes do not change. That push follows an Allow but can also be the host's routine re-mint ("Not now" sends nothing), so the retried write's result is the authority; a `TOKEN_REFRESH_RESPONSE` to a `getToken({ fresh: true })` never counts. "Not now" (no push within 60 s) and `CONSENT_UNAVAILABLE` reject with the first refusal, a refused retry rejects with its own (second) refusal, and nothing is asked or retried again; a caller abort during the wait rejects with the abort. A delete never asks. `GrantOptions` gains `from`, so `app.requestGrants(['apps:storage:publish'], { from })` asks for it directly — `true` on that push, `false` on `CONSENT_UNAVAILABLE` or after 60 s by itself; any other scopes with `from` resolve `false` without asking, as does a local preview or a sign-in session. `IframeTransport` now also delivers a host-pushed `TOKEN_REFRESH` to `on('TOKEN_REFRESH')` subscribers, after applying it. `DocumentStorageOptions` gains `requestGrants`. `createFakeStorage` gains `requestGrants`, the host's prompt: `true` records the grant in that source.

`@civitai/app-sdk`: the `REQUEST_CONSENT` payload carries `from?: string`.

`@civitai/blocks-react`: `useRequestConsent()` accepts `from`; the mock and live dev hosts answer a `from` request with `CONSENT_UNAVAILABLE` (`ungrantable`, `['apps:storage:publish']`), since neither has another app to grant it in.
