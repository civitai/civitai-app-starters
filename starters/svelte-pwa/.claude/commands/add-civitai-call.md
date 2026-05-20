---
description: Add a new BFF-side Civitai API call + SPA fetch helper
---

Add a Civitai API call named `$ARGUMENTS`.

## Files to touch (BFF → SPA, in order)

1. **`server/civitai.ts`** — add a server-only function taking `Session`,
   returning typed result. Use `callOrchestrator` from
   `@civitai/app-sdk/orchestrator` for orchestrator endpoints, or `fetch`
   with `env.CIVITAI_BASE_URL` + access token for civitai.com endpoints.

2. **`server/app.ts`** — add a Hono route. Read session via
   `readSession(c, production)`; return 401 if null. Mirror
   `app.get('/api/me', ...)`.

3. **`src/lib/api.ts`** — add a typed `fetch` wrapper for the SPA. Mirror
   `getMe()`. Throw on non-2xx so the `<svelte:boundary>` in `App.svelte`
   can surface it.

4. **`src/components/<consumer>.svelte`** — consume the wrapper. Never call
   `civitai.com` directly from the SPA; route through the BFF.

## Verify

```
pnpm typecheck       # svelte-check + server tsc
pnpm build
```

If the change touches the auth or generation flow, also:

```
pnpm test:e2e -- auth-flow
# or
pnpm test:e2e -- generation
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
