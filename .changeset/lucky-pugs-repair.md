---
'@civitai/sdk': minor
---

New subpath `@civitai/sdk/safe-storage` — repair web storage at an opaque origin.

A block is framed in a sandbox without `allow-same-origin` — civitai adds that
token only for the `internal`/`verified` trust tiers, and in v1 every approved
block is `unverified` — where merely *reading* `localStorage` or
`sessionStorage` throws a `SecurityError`. Any dependency that touches storage
while its module body evaluates then takes the whole block down, and nothing
outside that dependency can guard it.

`@civitai/app-sdk/blocks` has installed a repair for this since it shipped. An
app that has finished porting to `@civitai/sdk` imports neither that entry nor
`@civitai/blocks-react`, so it had no repair available at all. This adds one,
behind its own side-effect subpath:

```js
import '@civitai/sdk/safe-storage'; // keep it FIRST in your entry module
```

This is **opt-in, and the import must come first**. ES imports are hoisted, so a
storage-touching dependency imported above it still evaluates first. Importing
`@civitai/sdk` itself installs nothing: the package root stays pure re-exports,
side-effect-free and fully tree-shakeable, so nothing changes for Node/SSR
consumers.

Two things to know before importing it from an app at a **real** origin, where
storage works — neither can happen in the block sandbox it is built for:

- Classifying a store is a real round trip, so import writes and immediately
  removes `__civitai_app_sdk_storage_probe__` on `localStorage` and
  `sessionStorage`. Contents are unchanged and neither store is replaced, but
  each write queues a `storage` event in other documents sharing the store — a
  cross-tab listener that does not filter by key will see spurious events.
- A **full** store is indistinguishable from a disabled one through a write
  probe, so a `QuotaExceededError` counts as broken: the repair swaps in the
  in-memory fallback, seeded from everything it could still read. Nothing
  readable is lost, but persistence is — later writes are session-scoped.

`package.json` declares `sideEffects: ["./dist/safe-storage/index.js"]` instead
of `false`, because a bare `false` would let any bundler drop a side-effect-only
import. `./dist/index.js` is deliberately not in that allowlist.

Costs roughly 0.7 kB gzipped in a bundle that imports the subpath, and nothing
in one that does not.
