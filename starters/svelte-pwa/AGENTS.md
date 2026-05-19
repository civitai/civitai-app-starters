# Agent Guide — `svelte-pwa`

You're inside the bare Svelte 5 (no Kit) PWA starter for Civitai apps. The user (a developer) cloned this via `npx tiged` to bootstrap their own app. Help them extend it.

## Stack

- Vite 7 + Svelte 5 with runes + TypeScript strict
- Tailwind 3.4
- Hono BFF mounted at `/api/*` via `@hono/vite-dev-server` (dev) / `@hono/node-server` (prod)
- `vite-plugin-pwa` for manifest + service worker
- `@civitai/app-sdk` for all OAuth + orchestrator glue
- **No SvelteKit.** No `+page.svelte`, no load functions, no adapter — pure Svelte components mounted to `#app`.

## Why this shape (read before refactoring)

OAuth confidential client → `client_secret` MUST stay server-side. The BFF (`server/app.ts`) is the only thing that ever sees `client_secret` or the user's access token. The SPA holds an opaque `httpOnly` `civ_session` cookie set by the BFF.

This is intentional. **Do not** refactor to "talk to Civitai directly from Svelte" — that would either leak the secret or break the auth model.

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
├── env.ts                    # validated env — reads process.env populated by
│                             #   vite.config.ts loadEnv (dev) or
│                             #   `node --env-file=.env` (prod start script).
├── scopes.ts                 # REQUESTED_SCOPES bitmask
├── session.ts                # readSession / writeSession via app-sdk cookies
└── civitai.ts                # getMe + raw orchestrator calls

src/                          # Svelte SPA (tsconfig.json)
├── main.ts                   # mount(App, { target: #app })
├── App.svelte                # auth bootstrap via GET /api/me + main UI
├── app.css
├── components/
│   ├── LoginButton.svelte    # plain <form action="/api/auth/login">
│   ├── LogoutControls.svelte
│   └── GenerateForm.svelte   # estimate → submit → poll → display
└── lib/
    ├── api.ts                # fetch wrappers for /api/*
    └── civitai-types.ts      # client-safe types
```

## Patterns to keep

- **All Civitai traffic flows through the BFF.** SPA → `/api/*` → BFF → civitai.com / orchestrator. Never direct from the browser.
- **The SPA bootstraps auth via `GET /api/me`** in `onMount()`. 401 → show login. 200 → show signed-in UI. No client-side token reading.
- **Svelte 5 runes everywhere.** Use `$state<T>(...)` (with explicit generic to avoid literal narrowing on `null`/string-literal initializers), `$derived(...)`, `$props()`. Don't import from `svelte/store` unless you need cross-component subscription patterns the runes can't express.
- **Encrypted-cookie sessions, no DB.** `@civitai/app-sdk`'s `sealCookie`/`unsealCookie` (AES-256-GCM). One cookie holds the refresh token blob; another short-lived cookie holds the PKCE state during login.
- **Buzz cost preview before submission.** Always call `/api/generate/estimate` and show the cost before submitting.

## Patterns to avoid

- Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB` / Svelte state. The BFF holds them.
- Calling `civitai.com` or `orchestration.civitai.com` directly from `src/`. Add a BFF route instead.
- Adding SvelteKit. If you want Kit, switch to [`sveltekit-app`](../sveltekit-app/).
- Exposing `CIVITAI_CLIENT_SECRET` to the SPA build. Server-only env var.
- Adding a DB silently. Make the user opt in.

## Extending

| Task | How |
|---|---|
| Add a new Civitai API call | Add a function to `server/civitai.ts`, a route in `server/app.ts`, a fetch helper in `src/lib/api.ts`. |
| Request more OAuth scopes | Edit `server/scopes.ts` (`REQUESTED_SCOPES`). User re-consents on next login. |
| Add a generation engine option | Edit `buildWorkflowBody` in `server/civitai.ts` and the form UI in `src/components/GenerateForm.svelte`. |
| Add client-side routing | Wire a minimal hash-based router or `svelte-spa-router`. The BFF falls back to `index.html` for unmatched paths. |
| Persist generation history | Net-new infra. Recommend KV / D1 / Postgres. |
| Deploy to Cloudflare Workers | Swap `@hono/node-server` for `@hono/cloudflare-workers` in `server/index.ts`. Cookie crypto uses Node's `crypto` — needs `nodejs_compat` Worker flag or a Web Crypto shim. |

## Demo flow

1. Mount → `onMount` calls `GET /api/me` → 401 → render `<LoginButton>` → form posts to `/api/auth/login` → BFF 303 to civitai.com.
2. User consents → civitai.com redirects to `GET /api/auth/callback/civitai` → BFF exchanges code + seals session → 303 to `/?notice=connected`.
3. SPA re-mounts → `GET /api/me` → 200 with `{username, balance, grantedScopes}` → render `<GenerateForm>`.
4. User clicks "Preview Buzz cost" → `POST /api/generate/estimate` → display cost.
5. User clicks "Generate" → `POST /api/generate` → returns `workflowId` → SPA polls `GET /api/workflow/[id]` every 2s.
6. On terminal status → display image blobs.
