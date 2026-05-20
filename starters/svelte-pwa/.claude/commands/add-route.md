---
description: Add a new SPA route (and/or BFF API route)
---

Add a route at `/$ARGUMENTS`.

The PWA shell is a single-page Svelte app — there's no file-based router.
Add one of these (or both):

## SPA route

Wire a client-side router or hash routing. Minimal choices:

- **No router:** conditional `{#if}` in `src/App.svelte` based on a
  `$state` you derive from `window.location.pathname`.
- **Hash routing:** track `window.location.hash` with a Svelte effect.
- **Library:** [`svelte-spa-router`](https://www.npmjs.com/package/svelte-spa-router)
  — pull in only when you have 2+ routes.

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
