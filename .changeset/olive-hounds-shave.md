---
'@civitai/blocks-react': minor
---

Auto-install the SDK's opaque-origin web-storage shim on import, so React blocks (and any block using this package's transport) can't be taken down by a dependency that touches `localStorage` / `sessionStorage` unguarded.

`src/index.ts` now imports `@civitai/app-sdk/safe-storage` first. That module replaces `localStorage` / `sessionStorage` with an in-memory `Storage` only when a round-trip probe proves them unusable — working storage is untouched, a store that reads but refuses writes has its entries carried over, nothing is fabricated in Node/SSR, and it's idempotent. Nothing to call, no API change here.

`package.json` also declares `"sideEffects": ["./dist/index.js"]`. That import is the entire mechanism, and it is a bare side-effect import: without the declaration, a later blanket `"sideEffects": false` would let a bundler skip this entry module and drop the shim, with every test still green.

Bumps the `@civitai/app-sdk` peer range to `^0.27.0` (the minor that adds the `safe-storage` subpath), matching the established lockstep pattern.
