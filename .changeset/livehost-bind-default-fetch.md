---
'@civitai/blocks-react': patch
---

fix(live host): bind the default fetch to globalThis

`createLiveHost`'s default fetch was the bare `globalThis.fetch` reference;
called detached it throws "Illegal invocation" in browsers (fetch is a
DOM-bound builtin), which broke the catalog/picker overlay and every live-host
network call when no `fetchImpl` was supplied. The default now wraps it so the
call is always bound. Regression test asserts the global fetch is invoked with
`this === globalThis`.
