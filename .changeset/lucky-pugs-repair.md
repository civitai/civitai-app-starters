---
'@civitai/sdk': minor
---

Importing `@civitai/sdk` now repairs web storage at an opaque origin.

A block is framed in a sandbox without `allow-same-origin` — civitai adds that
token only for the `internal`/`verified` trust tiers, and in v1 every approved
block is `unverified` — where merely *reading* `localStorage` or
`sessionStorage` throws a `SecurityError`. Any dependency that touches storage
while its module body evaluates then takes the whole block down, and nothing
outside that dependency can guard it.

`@civitai/app-sdk/blocks` has installed a repair for this since it shipped. An
app that has finished porting to `@civitai/sdk` imports neither that entry nor
`@civitai/blocks-react`, so it had no repair at all. The package root now
installs one itself, before anything else in the app's module graph evaluates.

`package.json` therefore declares `sideEffects: ["./dist/index.js",
"./dist/safe-storage/index.js"]` instead of `false` — a bare `false` would let
any bundler drop the install. No public API changed; the shim is internal, and
the only thing an app has to do is keep its `@civitai/sdk` import first in its
entry module, ahead of dependencies that read storage.

Costs roughly 0.7 kB gzipped in a bundle that imports the package root.
