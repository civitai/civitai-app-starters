---
"@civitai/blocks-react": patch
---

`dev:live`: the live host now refuses `PUBLISH_GENERATION_OUTPUTS` instead of forwarding it

**Behaviour change for local `dev:live` harness users.** `createLiveHost` used to
forward `usePublishGenerationOutputs().publish()` to civitai.com. Publishing now
requires the viewer's signed-in civitai.com session, which the local harness does
not have, so the live host replies immediately on `PUBLISH_RESULT` with an error
saying so (and logs it once), the same way it already refuses
`CREATE_POST_FROM_APP`. `publish()` rejects with that message; it makes no network
call.

Test publishing against the mock host — `createMockHost` or `Harness` from
`@civitai/blocks-react/testing`, with the `publishImageIds` / `publishError`
options. Production blocks are unaffected.
