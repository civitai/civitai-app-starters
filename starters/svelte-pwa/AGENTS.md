# Agent Guide — `svelte-pwa`

> **If you only read one thing:** Vite + Svelte 5 (no Kit) SPA with a
> co-located Hono BFF at `/api/*`. OAuth tokens live only on the BFF
> (`server/`); the SPA (`src/`) sees only an opaque `civ_session` cookie.
> Demo: login → balance + scopes → cost preview → submit one generation →
> display.

You're inside the bare Svelte 5 (no Kit) PWA starter for Civitai apps. The
user cloned this via `npx tiged` — there is **no monorepo around you**;
`@civitai/app-sdk` is an npm dependency, not a sibling workspace.

## Stack

Vite 7 + Svelte 5 (runes) + TypeScript strict, Tailwind 3.4, Hono BFF via
`@hono/vite-dev-server` (dev) / `@hono/node-server` (prod), `vite-plugin-pwa`,
`@civitai/app-sdk`. **No SvelteKit** — pure components mounted to `#app`.

## Why this shape

OAuth confidential client → `client_secret` MUST stay server-side. The BFF
(`server/app.ts`) is the only thing that sees `client_secret` or the user's
access token; the SPA holds only an opaque `httpOnly` `civ_session` cookie.
**Do not** refactor to "talk to Civitai directly from Svelte" — that leaks
the secret or breaks the auth model.

## Where things live

| File | Purpose |
|---|---|
| `server/app.ts` | Hono routes — default-exports `app`. Loaded by both dev (`@hono/vite-dev-server`) and prod (`server/index.ts`). |
| `server/index.ts` | Prod entry — `@hono/node-server` `serve()` + static `dist/`. Not loaded in dev. |
| `server/env.ts` | Zod-validated env (`@t3-oss/env-core`). Reads `process.env` (Vite `loadEnv` dev / `--env-file=.env` prod). |
| `server/scopes.ts` | `REQUESTED_SCOPES` bitmask |
| `server/session.ts` | `readSession` / `writeSession` via app-sdk cookies |
| `server/civitai.ts` | `getMe` + raw orchestrator calls |
| `src/main.ts` | `mount(App, { target: #app })` |
| `src/App.svelte` | Auth bootstrap via `GET /api/me` + main UI, wrapped in `<svelte:boundary>` |
| `src/components/*.svelte` | `LoginButton`, `LogoutControls`, `GenerateForm` |
| `src/lib/api.ts` | Fetch wrappers for `/api/*` (types from `@civitai/app-sdk/orchestrator`) |

## Patterns to keep

- **All Civitai traffic flows through the BFF.** SPA → `/api/*` → BFF → civitai.com / orchestrator.
- **SPA bootstraps auth via `GET /api/me`** in `onMount()`. 401 → login. 200 → signed-in UI.
- **Svelte 5 runes.** `$state<T>(...)` (explicit generic to avoid literal narrowing on `null`), `$derived`, `$props`. Skip `svelte/store` unless runes can't express it.
- **Encrypted-cookie sessions, no DB.** `sealCookie`/`unsealCookie` (AES-256-GCM). Refresh-token cookie + short-lived PKCE-state cookie.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` first.

## Patterns to avoid

- Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB` / Svelte state. The BFF holds them.
- Calling `civitai.com` or `orchestration.civitai.com` directly from `src/`. Add a BFF route.
- Adding SvelteKit. Switch to [`sveltekit-app`](https://github.com/civitai/civitai-app-starters/tree/main/starters/sveltekit-app) if you want Kit.
- Exposing `CIVITAI_CLIENT_SECRET` to the SPA build. Server-only.
- Adding a DB silently. Make the user opt in.

## Extending

| Task | How |
|---|---|
| Add a Civitai API call | Function in `server/civitai.ts` → route in `server/app.ts` → fetch helper in `src/lib/api.ts`. |
| Request more OAuth scopes | Edit `REQUESTED_SCOPES` in `server/scopes.ts`. User re-consents on next login. |
| Add a generation engine option | Edit `buildWorkflowBody` in `server/civitai.ts` and the form in `src/components/GenerateForm.svelte`. |
| Add client-side routing | Hash router or `svelte-spa-router`. BFF falls back to `index.html` for unmatched paths. |
| Persist generation history | Net-new infra. Recommend KV / D1 / Postgres. |
| Deploy to Cloudflare Workers | Swap `@hono/node-server` for `@hono/cloudflare-workers` in `server/index.ts`. Cookie crypto needs `nodejs_compat` or a Web Crypto shim. |

## Demo flow

1. Mount → `onMount` `GET /api/me` → 401 → `<LoginButton>` → form posts `/api/auth/login` → BFF 303 to civitai.com.
2. Civitai redirects to `GET /api/auth/callback/civitai` → BFF exchanges code + seals session → 303 to `/?notice=connected`.
3. SPA re-mounts → `GET /api/me` → 200 `{username, balance, grantedScopes}` → `<GenerateForm>`.
4. "Preview Buzz cost" → `POST /api/generate/estimate` → display cost.
5. "Generate" → `POST /api/generate` → `workflowId` → SPA polls `GET /api/workflow/[id]` every 2s.
6. Terminal status → display image blobs.

## Verifying changes

| You touched | Run |
|---|---|
| Anything in `src/` or `server/` | `pnpm typecheck` (`svelte-check` + server tsc) |
| `vite.config.ts`, env, security headers | `pnpm build` |
| Auth flow (`server/app.ts` auth routes, `server/session.ts`) | `pnpm test:e2e -- auth-flow` |
| Generation flow (`server/app.ts` generate routes, polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
+ matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
