---
description: Add a new page route (with optional +server.ts API)
---

Add a route at `/$ARGUMENTS`.

## Files to touch

- **Page:** `src/routes/$ARGUMENTS/+page.svelte`. Add a sibling
  `+page.server.ts` with a `load` function if the page needs data — read
  session via `event.locals.session`; `throw redirect(303, '/')` if null.
- **API (optional):** `src/routes/api/$ARGUMENTS/+server.ts` — export named
  `GET` / `POST` functions per SvelteKit convention. Read session via
  `event.locals.session`; 401 if null.
- **Layout (optional):** `src/routes/$ARGUMENTS/+layout.svelte` for shared
  chrome.

## Security headers

Applied automatically by `hooks.server.ts`'s `handle` — no per-route action
needed.

## Verify

```
pnpm typecheck
pnpm build
pnpm dev          # visit http://localhost:5173/$ARGUMENTS
```

If the new route participates in OAuth or generation, also:

```
pnpm test:e2e -- auth-flow
# or
pnpm test:e2e -- generation
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
