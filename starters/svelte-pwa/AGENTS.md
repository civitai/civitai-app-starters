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

Vite 8 + Svelte 5 (runes) + TypeScript strict, Tailwind 4 (via `@tailwindcss/vite`), Hono BFF via
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
| `server/index.ts` | Prod entry — `@hono/node-server` `serve()` + static `dist/`. Not loaded in dev. Paths resolve from `import.meta.url`, **not** the CWD, and `index.html` is read once at boot. |
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
- 🔴 **Only a definite rejection signs the user out.** When the refresh in `readSession()` (`server/session.ts`) fails, the cookie is cleared only for an `OAuthError` whose body says `invalid_grant` (`isDefiniteRejection` in `server/refresh-tokens.ts`). A 5xx, a 429, a network error or a refused client secret (`invalid_client`) keeps the browser's cookie so a later request retries (after a 5 s per-session backoff, since the token endpoint is rate-limited); that one request is signed out. A request waits at most 10 s for a refresh. Concurrent requests with the same refresh token share one refresh call, and a success is reused for 60 s so a straggling request with the old cookie does not replay a rotated-away refresh token; signing out (`clearSession`) forgets that reuse at once. That dedupe is **per server process**: several instances can still race, which needs a shared store or a replay grace period on the auth server. The module is the same file in every standalone starter; `pnpm test` and `pnpm probe:expired-session` cover it.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` first. The estimate belongs to the exact prompt it priced: Generate stays disabled until the current prompt has an estimate with a numeric cost, and an absent cost is `null` ("Estimate unavailable"), never `0` — see `src/lib/estimate.ts`.
- 🔴 **The prod server never fetches itself, and resolves paths from `import.meta.url`.** `server/index.ts` used to do both wrong: `serveStatic({ root: './dist' })` against the process CWD, and an SPA fallback that did `fetch('http://localhost:' + PORT + '/index.html')`. Started from anywhere but the package root (systemd `WorkingDirectory`, a container `WORKDIR`, pm2), the static middleware missed and `/index.html` fell into the same catch-all that fetched it — unbounded recursion. Measured here: 25 requests, 20 → 93,304 open descriptors, every request timed out, and the server still logged `Listening`. `index.html` is read once at boot and served from memory, and a missing `dist/index.html` exits non-zero instead of starting a server that is broken on every route.
- 🔴 **`Secure` + HSTS derive from `APP_URL`'s scheme, never from `NODE_ENV`.** Nothing sets `NODE_ENV` — `pnpm start` is `node --env-file=.env dist-server/index.js` — so `NODE_ENV === 'production'` was false on a real production box, and the app shipped `civ_session` **without `Secure`** and no `Strict-Transport-Security`. It works perfectly over HTTPS either way, which is precisely why it goes unnoticed. `APP_URL` is required, URL-validated, and states the scheme the app is actually served over. `pnpm probe:cookie-flags` pins both directions.

## Patterns to avoid

- Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB` / Svelte state. The BFF holds them.
- Calling `civitai.com` or `orchestration.civitai.com` directly from `src/`. Add a BFF route.
- Adding SvelteKit. Switch to [`sveltekit-app`](https://github.com/civitai/civitai-app-starters/tree/main/starters/sveltekit-app) if you want Kit.
- Exposing `CIVITAI_CLIENT_SECRET` to the SPA build. Server-only.
- Adding a DB silently. Make the user opt in.
- Having the server `fetch()` its own origin, or resolving a bundled path against `process.cwd()`. Both were real bugs here; `pnpm probe:static-serving` guards against their return.

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
3. SPA re-mounts → `GET /api/me` → 200 `{username, balance, grantedScopes}` → `<GenerateForm>`. 🔴 The BFF reads `balance` from `getBuzzBalance()` (`buzz.getUserAccount`, needs `BuzzRead`), **not** from `/api/v1/me`, which returns none; it is `null` when the scope was not granted and the SPA then renders no row.
4. "Preview Buzz cost" → `POST /api/generate/estimate` → display the cost for that prompt. Generate is disabled until the current prompt has an estimate; editing the prompt or Reset discards it, a reply to a discarded estimate is ignored, and an estimate without a cost (`cost: null`) shows "Estimate unavailable".
5. "Generate" → `POST /api/generate` → `workflowId` → SPA polls `GET /api/workflow/[id]` every 2s.
6. Terminal status → display image blobs.

## Verifying changes

| You touched | Run |
|---|---|
| Anything in `src/` or `server/` | `pnpm typecheck` (`svelte-check` + server tsc) |
| `server/index.ts`, static serving, the SPA fallback | `pnpm probe:static-serving` |
| `server/app.ts` security headers, cookie flags, `server/env.ts` | `pnpm probe:cookie-flags` |
| `server/session.ts`, `server/refresh-tokens.ts`, the estimate or sign-out routes in `server/app.ts` | `pnpm probe:expired-session` (no Civitai needed: a stand-in runs in the probe) |
| `src/lib/estimate.ts`, `server/refresh-tokens.ts`, `GenerateForm` | `pnpm test` (needs Node ≥ 22.18: it imports the `.ts` modules with Node's built-in type stripping) |
| `vite.config.ts`, env, security headers | `pnpm build` |
| Auth flow (`server/app.ts` auth routes, `server/session.ts`) | `pnpm test:e2e -- auth-flow` |
| Generation flow (`server/app.ts` generate routes, polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
+ matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
