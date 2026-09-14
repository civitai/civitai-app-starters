---
'@civitai/app-sdk': minor
---

Add the `posts:write:self` block scope and the `CREATE_POST_FROM_APP` /
`CREATE_POST_RESULT` message pair — the App Blocks → Post bridge.

`posts:write:self` lets a block ask the host to publish a **real, published Post
on the viewer's profile** from the app's own outputs. It is **sensitive** and
**consent-gated**: a manifest declaring it must carry a `scopeJustifications`
entry or the server rejects it at submit, and the viewer is prompted to grant it.

The vendored canonical schema is re-vendored byte-identical to the live
`https://civitai.com/schemas/app-block/v1.json`, which now carries 13 scopes.

New exported types: `BlockPostSource`, `BlockCreatePostRequest`,
`BlockCreatePostResult`, `BlockCreatePostHostError`.

Note for the `CREATE_POST_RESULT` reply: `error` is a **union of the host's
closed refusal codes and arbitrary server text**. Test for a code by equality
against `BlockCreatePostHostError`; never assume the string is one of them.
