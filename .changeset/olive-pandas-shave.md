---
'@civitai/blocks-react': minor
---

Add `useCreatePostFromApp()` — publish a real, published Post on the viewer's
profile from the app's own outputs, over the host-mediated
`CREATE_POST_FROM_APP` → `CREATE_POST_RESULT` bridge.

Requires `@civitai/app-sdk@^0.40.0` and the `posts:write:self` scope. 🔴 The
`peerDependencies` floor stays the deliberately-wide `>=0.29.0 <1.0.0`, so npm
will not warn you: pairing this with an older SDK fails at `tsc` with
`Cannot find name 'BlockCreatePostHostError'`, not at install.

Also lands:

- the request is bucketed `'human'` (10-minute bound), because its reply waits on
  a host-chrome consent confirm — at the 30s protocol default it would reject
  with the dialog still open, and a viewer who then clicked Publish would get a
  real public post while the block reported a failure;
- an inbound `CREATE_POST_RESULT` validator, wired into `payloadValidatorFor`.
  `error` is shape-checked and deliberately **not** membership-checked: the
  channel carries free-text server messages, and a dropped reply on a
  REQUEST-style message does not reject — it hangs the block for the full
  ten-minute bound;
- `createPostResult` / `createPostError` scenario knobs on `createMockHost`.
  `dev:live` refuses this bridge on purpose (no civitai chrome to render the
  server-resolved confirm in).

⚠️ Posting a previously-published image **removes it from the app's own grid**:
the app-scoped read behind `useGatedImages()` is conjoined with `postId IS NULL`.
