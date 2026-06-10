---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the `REQUEST_CONSENT` block→host message (lazy consent).

`@civitai/app-sdk`: add `REQUEST_CONSENT` (payload `{ scopes?: string[] }`) to
the `BlockToParentMessage` union. A block rendered for a LOGGED-IN viewer whose
token is missing a consent-gated scope (e.g. `ai:write:budgeted` /
`buzz:read:self` were withheld at mint because the viewer hasn't granted them
yet) sends this to ask the host to open its consent UI when the user clicks an
action that needs that capability (e.g. Generate) — instead of prompting on
load. The host already knows the missing scopes (from the mint response), so
`scopes` is an optional advisory hint. The host validates it like every inbound
message (origin + `event.source` pinned, only honored after BLOCK_READY).
Fire-and-forget — on grant the host re-mints and pushes a `TOKEN_REFRESH`
carrying the now-granted scopes; the block observes the new scope and retries.

`@civitai/blocks-react`: add the `useRequestConsent()` hook returning
`requestConsent(payload?)`, a fire-and-forget helper mirroring
`useRequestSignIn()`.
