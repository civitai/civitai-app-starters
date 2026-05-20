# Agent Guide — `sveltekit-app`

> **If you only read one thing:** this is a SvelteKit 2 app whose only
> persistent state is an encrypted session cookie. OAuth tokens never leave
> the server (`+server.ts` handlers + `hooks.server.ts`). The demo: login →
> balance + scopes → cost preview → submit one generation → display.

This is a SvelteKit 2 starter for Civitai apps. The user cloned it via
`npx tiged` to bootstrap their own app — there is **no monorepo around
you**; `@civitai/app-sdk` is an npm dependency, not a sibling workspace.
Help them extend it.

## Stack

- SvelteKit 2, TypeScript strict
- Svelte 5 with runes (`$state`, `$derived`, `$props`)
- Tailwind 3.4
- `@civitai/app-sdk` for all OAuth + orchestrator glue
- `@sveltejs/adapter-auto` — deploys to Vercel / Cloudflare / Node out of the box
- No DB, no Redis, no external session store — encrypted-cookie sessions only

## File layout

```
src/
├── app.html
├── app.css
├── app.d.ts                # App.Locals.session typing
├── hooks.server.ts         # populates event.locals.session per request
├── lib/
│   ├── env.ts              # validated env config
│   ├── scopes.ts           # REQUESTED_SCOPES bitmask
│   ├── session.ts          # readSession / writeSession / OAuth state cookie
│   ├── civitai.ts          # server-only orchestrator helpers (re-exports SDK types)
│   └── components/
│       ├── GenerateForm.svelte
│       └── LogoutControls.svelte
└── routes/
    ├── +layout.svelte
    ├── +page.server.ts     # loads /me + scopes when authed
    ├── +page.svelte        # demo home
    └── api/
        ├── auth/
        │   ├── login/+server.ts
        │   ├── callback/civitai/+server.ts
        │   ├── logout/+server.ts
        │   └── revoke/+server.ts
        ├── generate/
        │   ├── +server.ts
        │   └── estimate/+server.ts
        └── workflow/[id]/+server.ts
```

## Patterns to keep

- **OAuth + tokens stay server-side.** Never expose `access_token`, `refresh_token`, or `CIVITAI_CLIENT_SECRET` to the browser. The client sees only the opaque `civ_session` cookie.
- **Read session via `event.locals.session`**, set by `hooks.server.ts`. Don't reach into `cookies` directly in route handlers — that's the hooks' job.
- **All Civitai API calls happen in `+server.ts` handlers**, not in components. `+page.server.ts` is fine for fetching during page load.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` and show the cost before submitting. Users blame the app, not Civitai, when they're surprised by Buzz spend.

## Patterns to avoid

- ❌ `localStorage` / non-httpOnly cookies / rendered HTML for tokens.
- ❌ Auth.js / `@auth/sveltekit`. The starter hand-rolls the four auth endpoints directly on `@civitai/app-sdk` to avoid stateful infra. If multiple providers are needed, the user can layer Auth.js on themselves.
- ❌ Hard-coding orchestrator base URLs — use `config.ORCHESTRATOR_URL` from `$lib/env`.
- ❌ Adding new env vars without updating `.env.example` and `src/lib/env.ts`.
- ❌ Adding a DB for "just storing some stuff" — make the user opt in. Suggest Vercel KV / Cloudflare D1 / Postgres explicitly.

## Extending

| Task | How |
|---|---|
| Add a new Civitai API call | Add a function to `$lib/civitai.ts`. Use the SDK's `fetchMe` pattern or raw fetch to the orchestrator. |
| Request more OAuth scopes | Edit `$lib/scopes.ts` (`REQUESTED_SCOPES`). User will re-consent on next login. |
| Add a generation engine option | Edit `buildWorkflowBody` in `$lib/civitai.ts` and the form UI in `GenerateForm.svelte`. Keep it small — don't ship 30 engine configs. |
| Persist history | Net-new infra — flag it. Recommend Vercel KV or Postgres. Don't silently add Drizzle. |
| Switch deploy target | Edit `svelte.config.js` adapter (`adapter-vercel`, `adapter-cloudflare`, `adapter-node`). Cookie crypto is Node-API-only, so Cloudflare Workers won't work without a Node-compat shim or alternative crypto. |

## Demo flow

1. Logged out → `<form action="/api/auth/login">` posts → `POST /api/auth/login` → PKCE + state seal + 303 to Civitai.
2. Civitai redirects back with `code` + `state` → `GET /api/auth/callback/civitai` exchanges → session sealed → 303 home.
3. Logged in → `+page.server.ts` calls `getMe()` and passes balance/scopes to `+page.svelte`.
4. Submit prompt → client `POST /api/generate/estimate` → display Buzz cost.
5. Confirm → client `POST /api/generate` → returns workflowId → client polls `GET /api/workflow/[id]` every 2s.
6. On terminal status → display image blobs from `steps[0].output.blobs`.

## Verifying changes

After any meaningful change, run the matching check before declaring done:

| You touched | Run |
|---|---|
| Anything in `src/` | `pnpm typecheck` (`svelte-check` + svelte-kit sync) |
| `svelte.config.js`, env wiring, security headers | `pnpm build` |
| Auth flow (`src/routes/api/auth/**`, `hooks.server.ts`, `$lib/session.ts`) | `pnpm test:e2e -- auth-flow` |
| Generation flow (`src/routes/api/generate/**`, workflow polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
and matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
