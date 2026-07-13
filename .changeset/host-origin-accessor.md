---
"@civitai/blocks-react": minor
---

feat(blocks-react): expose the validated host origin via `useHostOrigin()`

Blocks that need to direct-fetch the Civitai App Blocks HTTP API (bypassing the
host bridge) must send their bearer block token to the RIGHT host. Add a public
way to get that host: the origin the SDK already validated `BLOCK_INIT` came
from — never a spoofable signal like `document.referrer`.

- New React hook `useHostOrigin(): string | undefined` (sibling of
  `useBlockToken`, same `useSyncExternalStore` subscription). `undefined` until
  init, then exactly the validated parent origin.
- New transport accessor `getHostOrigin(): string | null` on the `BlockTransport`
  interface, implemented by both `IframeTransport` (returns the `parentOrigin`
  captured from the first allowlist-passing `BLOCK_INIT`) and `InlineTransport`
  (returns the same-document host origin once bootstrapped).

Security invariant: the returned value is ONLY ever an origin that passed the
transport's trust gate (the iframe `OriginMatcher` allowlist, or the inline
same-origin host). It is never derived from `document.referrer`,
`window.location` of a cross-origin parent, or an unvalidated `event.origin`.
The block token is a money-scoped bearer credential, so returning an unvalidated
origin would be a token-exfiltration vector — a non-allowlisted `BLOCK_INIT` is
dropped at the origin gate and the host origin stays null.
