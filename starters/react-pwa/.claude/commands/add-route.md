---
description: Add a new SPA route (and/or BFF API route)
---

Add a route at `/$ARGUMENTS`.

The PWA shell is a single-page app — there's no file-based router. Add one
of these (or both):

## SPA route

Wire a client-side router or hash routing. Minimal choices:

- **No router:** conditional render in `src/App.tsx` based on
  `window.location.pathname`.
- **Hash routing:** read `window.location.hash`; swap rendered component.
- **Library:** `react-router` (`npm i react-router`) — bring it in only if you
  need 2+ routes.

The BFF in `server/index.ts` already falls back to `index.html` for
unmatched paths in prod, so deep links work.

## BFF API route (optional)

Add `app.<method>('/api/$ARGUMENTS', async (c) => { ... })` to
`server/app.ts`. Read session via `readSession(c, production)`; return 401
if null. Add a fetch wrapper in `src/lib/api.ts`.

## Security headers

Applied automatically by the `secureHeaders` middleware in `server/app.ts`
— no per-route action needed.

## Verify

```
pnpm typecheck
pnpm build
pnpm dev          # navigate to /$ARGUMENTS
```

See [AGENTS.md › Verifying changes](../../AGENTS.md#verifying-changes).
