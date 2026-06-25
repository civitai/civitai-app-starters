---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the `REQUEST_SIGN_IN` block→host message (anonymous conversion).

`@civitai/app-sdk`: add `REQUEST_SIGN_IN` (payload `{ returnUrl?: string }`) to
the `BlockToParentMessage` union. A block rendered for a logged-out viewer
(`BLOCK_INIT.viewer === null`) sends this to ask the host to start civitai.com's
login flow when the user clicks an action that needs auth/money (e.g. Generate).
The host validates it like every inbound message (origin + `event.source`
pinned, only honored after BLOCK_READY) and sanitises `returnUrl` to a
same-origin in-app path, defaulting to the current page when omitted.

`@civitai/blocks-react`: add the `useRequestSignIn()` hook returning
`requestSignIn(payload?)`, a fire-and-forget helper that posts the message
through the active transport.
