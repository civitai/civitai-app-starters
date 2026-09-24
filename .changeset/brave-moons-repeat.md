---
'@civitai/sdk': patch
---

`BREAKING.md` and `README.md` corrections. Both ship in the tarball and are what
a porting app reads, so several of their claims were sending people the wrong way.

**Two things here are actions you should take, not just doc fixes:**

- **Delete any `{ query: { id: context.modelId } }` workaround** you carry on
  block REST calls. Scope binding became per-route in civitai `3a1e090924`, so the
  unrelated-scope 403 that workaround existed for cannot happen. The old text told
  you to add it to *every* block REST call.
- **Change `app.site.get('me')` to `app.site.get('blocks/me')`.** The former
  resolves to `/api/v1/me`, an `AuthedEndpoint` that does not accept a block
  token, so it 401s.

Also corrected:

- **Anonymous shared-storage reads work on REST.** The same fix unblocked them; if
  you deferred a signed-out-browsing migration over that 403, it is unblocked.
- **The `APP_STORAGE_*` routes exist and are POST-only** (`get`, `set`, `delete`,
  `list`, `quota`) — the row previously said "No v1 route", then briefly said
  `GET|POST`.
- **Submit generations through `/api/v1/blocks/workflows/*`, not
  `app.orchestration`.** The raw orchestrator drops the Buzz budget, the caps, the
  maturity clamp and the attribution tag, and the substitution type-checks. The
  README quick-start now says so at the call site.
- **The block token reaches more than `/api/v1/blocks/*`** — 35 routes, including
  `GET /api/v1/models/{id}`. 🔴 But note `/api/v1/images` is a *public* endpoint:
  it ignores your token and answers with anonymous results rather than refusing,
  so use `/api/v1/blocks/images`.
- **Error bodies are not uniformly `{ message }`.** Middleware rejections carry
  `{ error }` only; read `message ?? error` and branch on the status.
- **The manifest `auth` field** is documented as built but flag-gated, with a way
  to tell from the outside which mode you actually got.
- Scope binding, shared-storage counts and the anon-write status corrected
  throughout.
