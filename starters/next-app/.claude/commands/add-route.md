---
description: Add a new page route (with optional API route)
---

Add a route at `/$ARGUMENTS`.

## Files to touch

- **Page:** `src/app/$ARGUMENTS/page.tsx` — server component by default.
  Add `'use client'` only if you need event handlers / state. If the page
  needs the session, call `getSession()` from `src/lib/session.ts` at the
  top; redirect to `/` if `null`.
- **API (optional):** `src/app/api/$ARGUMENTS/route.ts` — export named
  `GET` / `POST` functions per Next App Router convention. Read session via
  `getSession()`; 401 if missing.
- **Loading state (optional):** `src/app/$ARGUMENTS/loading.tsx` — mirror the
  skeleton in `src/app/loading.tsx`.

## Security headers

Apply automatically via `next.config.mjs` `headers()` — no per-route action
needed.

## Verify

```
pnpm typecheck
pnpm build
pnpm dev          # visit http://localhost:3000/$ARGUMENTS
```

If the new route participates in OAuth or generation, also:

```
pnpm test:e2e -- auth-flow
# or
pnpm test:e2e -- generation
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
