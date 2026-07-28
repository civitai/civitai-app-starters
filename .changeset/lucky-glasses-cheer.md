---
'@civitai/app-sdk': minor
---

Add `@civitai/app-sdk/safe-storage` — a spec-shaped in-memory `Storage` that keeps blocks alive at an opaque origin, auto-installed by the `blocks` subpath.

Block iframes are sandboxed as `allow-scripts allow-forms` **without `allow-same-origin`**, so the document has an opaque origin and merely *reading* `localStorage` / `sessionStorage` throws `SecurityError: … lacks the 'allow-same-origin' flag`. Guarding your own call sites doesn't help — the failure arrives through third-party dependencies, which routinely mislabel it. A live app went down this way: a panorama viewer's unguarded `KEY in localStorage` touch probe threw, the library caught it and rendered "Your browser does not seem to support WebGL", and the app's own fallback never ran. Every block that pulls in a storage-touching dependency rediscovers this, so it's fixed here once.

`installSafeStorage(scope?)` replaces `localStorage` / `sessionStorage` with a `Map`-backed `Storage` when — and only when — a real round-trip probe shows they're unusable:

- **No-op where storage works.** A healthy `Storage` is never replaced and its contents are never touched.
- **No-op where storage is absent** (Node / SSR / workers). Nothing is fabricated, so `typeof localStorage === 'undefined'` feature detection still behaves server-side.
- **Idempotent**, and safe to call as often as you like.
- **Reads-fine-but-writes-throw** (a full quota, storage disabled) is also covered, and the fallback **inherits the existing entries first** so it can't shadow a live session — that store's data is real and readable, unlike an opaque origin's. Writes made after the swap are session-scoped like every other install path.
- **Never throws.** Every step is guarded, including the probe's own property reads: a revoked `Proxy` or a throwing getter parked on `localStorage` classifies as broken instead of escaping. This installs at module scope, so an error here would reject `import '@civitai/app-sdk/blocks'` outright and take down every block that imports it.
- Implemented as a **Proxy, not a class**, because real `Storage` is exotic: `KEY in storage`, `storage[KEY] = v`, `delete storage[KEY]` and `Object.keys(storage)` all behave as they do on the real thing. That exact shape is what libraries use — right down to `delete storage.getItem` being a no-op and `Object.freeze(storage)` being refused rather than permanently breaking enumeration.
- Existence is tested with `'localStorage' in scope`, never `typeof localStorage`: in a real sandbox **`typeof` throws too**, because it still resolves the property and runs the throwing getter. `in` runs `[[HasProperty]]`, which cannot, and it correctly reports `true` there — the global exists, it is merely unreadable.

It **installs on import**, because ES module imports are hoisted: no statement can run before a sibling import of a dependency that reads storage while evaluating — only another import can. `@civitai/app-sdk/blocks` imports it first, so blocks get the fix without knowing it exists. For a dependency imported *ahead* of the SDK, put `import '@civitai/app-sdk/safe-storage';` at the top of your entry file; before a dynamic import, call `installSafeStorage()`.

`package.json` now declares `sideEffects` as an allow-list (`dist/safe-storage/index.js`, `dist/blocks/index.js`) rather than leaving it unset. The whole mechanism is a bare `import '…/safe-storage'`, so a future blanket `"sideEffects": false` would let bundlers tree-shake it away — silently, since Node/vitest doesn't tree-shake and nothing would fail in CI.

The fallback is session-scoped — nothing survives a reload, which is the honest semantic at an opaque origin. Use the app-storage messages for anything durable. `createMemoryStorage()` is exported for standalone use, and `installSafeStorage` / `createMemoryStorage` are re-exported from `@civitai/app-sdk/blocks`.
