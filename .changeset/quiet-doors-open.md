---
'@civitai/blocks-client': minor
---

`createSignIn()` signs a viewer in with Civitai from a browser app outside
civitai.com — PKCE against `auth.civitai.com`, no server, no client secret — and
is what `initialize()` takes. Tokens stay in memory and refresh themselves;
`requestGrants` goes back to Civitai for scopes not yet granted.
