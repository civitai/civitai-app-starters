# Agent Guide — `react-pwa`

> **If you only read one thing:** this is a Vite + React SPA with a
> co-located Hono BFF at `/api/*`. OAuth tokens live only on the BFF
> (`server/`); the SPA (`src/`) only ever sees an opaque `civ_session`
> cookie. The demo: login → balance + scopes → cost preview → submit one
> generation → display.

You're inside the React PWA starter for Civitai apps. The user cloned this
to bootstrap their own app — there is **no monorepo around you**;
`@civitai/app-sdk` is an npm dependency, not a sibling workspace. Help them
extend it.

## Stack

- Vite 7 + React 19 + TypeScript strict
- Tailwind 3.4
- Hono BFF mounted at `/api/*` via `@hono/vite-dev-server` (dev) / `@hono/node-server` (prod)
- `vite-plugin-pwa` for manifest + service worker
- `@civitai/app-sdk` for all OAuth + orchestrator glue

## Why this shape

OAuth confidential client → `client_secret` MUST stay server-side. The BFF (`server/app.ts`) is the only thing that ever sees `client_secret` or the user's access token; the SPA holds only an opaque `httpOnly` `civ_session` cookie. **Do not** refactor to "talk to Civitai directly from React" — that leaks the secret or breaks the auth model.

## File layout

```
server/                       # Hono BFF (tsconfig.server.json)
├── app.ts                    # routes — default-exports the Hono `app`. Both
│                             #   dev (@hono/vite-dev-server loads this via
│                             #   `entry: 'server/app.ts'`) and prod
│                             #   (server/index.ts imports it) consume it.
├── index.ts                  # prod entry only — calls @hono/node-server's
│                             #   serve() and serves static dist/. NOT loaded
│                             #   in dev (Vite's middleware handles that).
│                             #   Paths resolve from import.meta.url, NOT the
│                             #   CWD, and index.html is read once at boot.
├── env.ts                    # validated env — reads process.env populated by
│                             #   vite.config.ts loadEnv (dev) or
│                             #   `node --env-file=.env` (prod start script).
├── scopes.ts                 # REQUESTED_SCOPES bitmask
├── session.ts                # readSession / writeSession via app-sdk cookies
└── civitai.ts                # getMe + raw orchestrator calls

src/                          # React SPA (tsconfig.json)
├── main.tsx
├── App.tsx                   # auth bootstrap via GET /api/me + main UI
├── index.css
├── components/
│   ├── LoginButton.tsx       # plain form POST /api/auth/login
│   ├── LogoutControls.tsx
│   └── GenerateForm.tsx      # estimate → submit → poll → display
└── lib/
    └── api.ts                # fetch wrappers for /api/* (types live in @civitai/app-sdk/orchestrator)
```

## Patterns to keep

- **All Civitai traffic flows through the BFF.** SPA → `/api/*` → BFF → civitai.com / orchestrator. Never direct from the browser.
- **The SPA bootstraps auth via `GET /api/me`** on mount. 401 → show login. 200 → show signed-in UI. No client-side token reading.
- **Encrypted-cookie sessions, no DB.** `@civitai/app-sdk`'s `sealCookie`/`unsealCookie` (AES-256-GCM). One cookie holds the refresh token blob; another short-lived cookie holds the PKCE state during the login handshake.
- **Buzz cost preview before submission.** Call `/api/generate/estimate` and show the cost before submitting. Users blame the app, not Civitai, when surprised by Buzz spend.
- 🔴 **The prod server never fetches itself, and resolves paths from `import.meta.url`.** `server/index.ts` used to do both wrong: `serveStatic({ root: './dist' })` against the process CWD, and an SPA fallback that did `fetch('http://localhost:' + PORT + '/index.html')`. Started from anywhere but the package root (systemd `WorkingDirectory`, a container `WORKDIR`, pm2), the static middleware missed and `/index.html` fell into the same catch-all that fetched it — unbounded recursion. Measured: 25 requests, 20 → 92,124 open descriptors, every request timed out, and the server still logged `Listening`. `index.html` is read once at boot and served from memory, and a missing `dist/index.html` exits non-zero instead of starting a server that is broken on every route.
- 🔴 **`Secure` + HSTS derive from `APP_URL`'s scheme, never from `NODE_ENV`.** Nothing sets `NODE_ENV` — `pnpm start` is `node --env-file=.env dist-server/index.js` — so `NODE_ENV === 'production'` was false on a real production box, and the app shipped `civ_session` **without `Secure`** and no `Strict-Transport-Security`. It works perfectly over HTTPS either way, which is precisely why it goes unnoticed. `APP_URL` is required, URL-validated, and states the scheme the app is actually served over. `pnpm probe:cookie-flags` pins both directions.

## Patterns to avoid

- ❌ Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB` / React state. The BFF holds them.
- ❌ Calling `civitai.com` or the orchestrator host directly from `src/`. Add a BFF route instead.
- ❌ Exposing `CIVITAI_CLIENT_SECRET` to the SPA build. It's a server-only env var. `vite-plugin-pwa` won't include it because nothing in `src/` references it.
- ❌ Adding a DB. The starter is stateless. If the user needs persistence, suggest Vercel KV / Cloudflare D1 / Postgres explicitly.
- ❌ Removing the BFF to "make it a real SPA." See "Why this shape" above.
- ❌ Having the server `fetch()` its own origin, or resolving a bundled path against `process.cwd()`. Both were real bugs here; `pnpm probe:static-serving` guards against their return.

## Extending

- **New Civitai API call** — add a function to `server/civitai.ts`, a route in `server/app.ts`, and a fetch helper in `src/lib/api.ts`.
- **More OAuth scopes** — edit `REQUESTED_SCOPES` in `server/scopes.ts`. User re-consents on next login.
- **New generation option** — edit `buildWorkflowBody` in `server/civitai.ts` and the form in `src/components/GenerateForm.tsx`.
- **New SPA route** — conditional render or wire in a router. The BFF falls back to `index.html` for unmatched paths in prod.
- **Persist generation history** — net-new infra. Recommend KV / D1 / Postgres. Don't silently add Prisma.
- **Deploy to Cloudflare Workers** — swap `@hono/node-server` for `@hono/cloudflare-workers` in `server/index.ts`; cookie crypto needs `nodejs_compat` or a Web Crypto shim.

## Demo flow

1. Mount → `GET /api/me` → 401 → render `<LoginButton>` → form posts to `/api/auth/login` → BFF 303 to civitai.com.
2. User consents → civitai.com redirects to `GET /api/auth/callback/civitai` → BFF exchanges code + seals session → 303 to `/?notice=connected`.
3. SPA re-mounts → `GET /api/me` → 200 with `{username, balance, grantedScopes}` → render `<GenerateForm>`. 🔴 The BFF reads `balance` from `getBuzzBalance()` (`buzz.getUserAccount`, needs `BuzzRead`), **not** from `/api/v1/me`, which returns none; it is `null` when the scope was not granted and the SPA then renders no row.
4. User clicks "Preview Buzz cost" → `POST /api/generate/estimate` → display cost.
5. User clicks "Generate" → `POST /api/generate` → returns `workflowId` → SPA polls `GET /api/workflow/[id]` every 2s.
6. On terminal status → display image blobs from `steps[0].output.blobs`.

## Verifying changes

After any meaningful change, run the matching check before declaring done:

| You touched | Run |
|---|---|
| Anything in `src/` or `server/` | `pnpm typecheck` (both tsconfigs) |
| `server/index.ts`, static serving, the SPA fallback | `pnpm probe:static-serving` |
| `server/app.ts` security headers, cookie flags, `server/env.ts` | `pnpm probe:cookie-flags` |
| `vite.config.ts`, env wiring, security headers | `pnpm build` |
| Auth flow (`server/app.ts` auth routes, `server/session.ts`) | `pnpm test:e2e -- auth-flow` |
| Generation flow (`server/app.ts` generate routes, workflow polling) | `pnpm test:e2e -- generation` |

`pnpm test:e2e` needs a Civitai dev server with the `testing-login` provider
and matching OAuth app — see [README › End-to-end tests](./README.md#end-to-end-tests).
