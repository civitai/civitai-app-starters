---
description: Add a new server-side Civitai API call + exposing +server.ts route
---

Add a Civitai API call named `$ARGUMENTS`.

## Files to touch

1. **`src/lib/civitai.ts`** — add a server-only function taking `Session`,
   returning typed result. Use `callOrchestrator` from
   `@civitai/app-sdk/orchestrator` for orchestrator endpoints, or `fetch` with
   `config.CIVITAI_BASE_URL` + access token for civitai.com endpoints.
2. **`src/routes/api/<name>/+server.ts`** — `+server.ts` handler that reads
   `event.locals.session` (populated by `hooks.server.ts`). Return 401 if
   null. Mirror `src/routes/api/auth/login/+server.ts`.
3. **Consumer:**
   - From a `+page.server.ts` load function: call the helper directly with
     `event.locals.session`.
   - From client code: `fetch('/api/<name>')`.

Never call the helper from `+page.svelte` directly — it imports
server-only modules.

## Verify

```
pnpm typecheck
pnpm build
```

If the change touches the auth or generation flow, also:

```
pnpm test:e2e -- auth-flow
# or
pnpm test:e2e -- generation
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
