---
'@civitai/app-sdk': minor
---

Add `@civitai/app-sdk/safe-storage` — a spec-shaped in-memory `Storage` that keeps blocks alive at an opaque origin, auto-installed by the `blocks` subpath.

Block iframes are sandboxed as `allow-scripts allow-forms` **without `allow-same-origin`**, so the document has an opaque origin and merely *reading* `localStorage` / `sessionStorage` throws `SecurityError: … lacks the 'allow-same-origin' flag`. Guarding your own call sites doesn't help — the failure arrives through third-party dependencies, which routinely mislabel it. A live app went down this way: a panorama viewer's unguarded `KEY in localStorage` touch probe threw, the library caught it and rendered "Your browser does not seem to support WebGL", and the app's own fallback never ran. Every block that pulls in a storage-touching dependency rediscovers this, so it's fixed here once.

`installSafeStorage(scope?)` replaces `localStorage` / `sessionStorage` with a `Map`-backed `Storage` when — and only when — a real round-trip probe shows they're unusable:

- **No-op where storage works.** A healthy `Storage` is never replaced and its contents are never touched.
- **No-op where storage is absent** (Node / SSR / workers). Nothing is fabricated, so `typeof localStorage === 'undefined'` feature detection still behaves server-side.
- **Idempotent**; also repairs the read-fine-but-write-throws case (quota/disabled).
- Implemented as a **Proxy, not a class**, because real `Storage` is exotic: `KEY in storage`, `storage[KEY] = v`, `delete storage[KEY]` and `Object.keys(storage)` all behave as they do on the real thing. That exact shape is what libraries use.

It **installs on import**, because ES module imports are hoisted: no statement can run before a sibling import of a dependency that reads storage while evaluating — only another import can. `@civitai/app-sdk/blocks` imports it first, so blocks get the fix without knowing it exists. For a dependency imported *ahead* of the SDK, put `import '@civitai/app-sdk/safe-storage';` at the top of your entry file; before a dynamic import, call `installSafeStorage()`.

The fallback is session-scoped — nothing survives a reload, which is the honest semantic at an opaque origin. Use the app-storage messages for anything durable. `createMemoryStorage()` is exported for standalone use, and `installSafeStorage` / `createMemoryStorage` are re-exported from `@civitai/app-sdk/blocks`.
