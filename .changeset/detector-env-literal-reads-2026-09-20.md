---
'@civitai/blocks-react': patch
---

Read the parent-origin allowlist env vars with **literal** keys instead of a computed
`readEnv(key)` lookup. Two defects, in opposite directions, both invisible to a unit test
that only asserts what `readAllowedOriginsFromEnv()` returns.

**Leak.** `dist/internal/detector.js` read `import.meta.env?.[key]`. Vite substitutes
`import.meta.env.SOME_LITERAL` at build time by static analysis; a computed key cannot be
analysed, so Vite falls back to inlining the **entire env object** at the access site.
Every `VITE_*` variable a block app defines — `VITE_LIVE_BLOCK_TOKEN` included — was
therefore emitted into its production bundle. Reproduced against the published
`@civitai/blocks-react@0.55.0` tarball and against a Vite 8 build.

**Silent miss.** The same helper read `globalThis.process?.env?.[key]`. webpack/Next.js
`DefinePlugin` replaces only the literal member expression `process.env.NEXT_PUBLIC_FOO`,
and a browser bundle has no real `process` to fall back to — so
`NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` resolved to `undefined` in a Next.js block app
and the allowlist came back empty. The reads are now spelled bare
(`process.env.NEXT_PUBLIC_…`), which is the form `DefinePlugin` actually keys on.

No API change: `readAllowedOriginsFromEnv`, `BlockTransportDetector` and `DetectOptions`
keep their exact shapes, the `VITE_` → `NEXT_PUBLIC_` → `PUBLIC_` precedence is unchanged,
and the `try`/`catch` around each read still makes an absent `import.meta`/`process`
non-throwing in both runtimes.

Pinned by `test/detectorEnvBundle.test.ts`, which bundles the detector with Vite and
asserts on the emitted JavaScript — a decoy env var must not appear in the output, and a
companion positive-control bundle of the old computed-key read proves the harness can see
a leak at all.
