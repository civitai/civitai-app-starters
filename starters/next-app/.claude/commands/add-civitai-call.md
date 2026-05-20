---
description: Add a new server-side Civitai API call + exposing route handler
---

Add a Civitai API call named `$ARGUMENTS`.

## Files to touch

1. **`src/lib/civitai.ts`** — add a server-only function that takes the
   `Session` and returns a typed result. Use the SDK's `createAppClient` or
   `callOrchestrator` from `@civitai/app-sdk/orchestrator` if you're hitting
   the orchestrator; use `fetch(env.CIVITAI_BASE_URL + ...)` with the access
   token if you're hitting `civitai.com` directly.
2. **`src/app/api/<name>/route.ts`** — thin route handler that reads the
   session with `getSession()` (returns 401 if missing), calls your new
   function, and returns the JSON payload.
3. **`src/components/<consumer>.tsx`** — fetch from the new route via
   `fetch('/api/<name>', { method: 'GET' })`. Never call the new server
   function directly from a client component; the access token would leak.

## Pattern

Mirror the shape of `src/app/api/auth/login/route.ts` for the route, and
`getMe` in `src/lib/civitai.ts` for the call.

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
