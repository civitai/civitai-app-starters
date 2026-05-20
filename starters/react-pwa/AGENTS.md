# Agent Guide — `react-pwa`

You're inside the React PWA starter for Civitai apps. The user cloned this to bootstrap their own app. Help them extend it.

## Stack

- Vite 7 + React 19 + TypeScript strict
- Tailwind 3.4
- Hono BFF mounted at `/api/*` via `@hono/vite-dev-server` (dev) / `@hono/node-server` (prod)
- `vite-plugin-pwa` for manifest + service worker
- `@civitai/app-sdk` for all OAuth + orchestrator glue

## Why this shape (read before refactoring)

OAuth confidential client → `client_secret` MUST stay server-side. The BFF (`server/app.ts`) is the only thing that ever sees `client_secret` or the user's access token. The SPA holds an opaque `httpOnly` `civ_session` cookie set by the BFF.

This is intentional. **Do not** refactor to "talk to Civitai directly from React" — that would either leak the secret or break the auth model.

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

## Patterns to avoid

- ❌ Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB` / React state. The BFF holds them.
- ❌ Calling `civitai.com` or the orchestrator host directly from `src/`. Add a BFF route instead.
- ❌ Exposing `CIVITAI_CLIENT_SECRET` to the SPA build. It's a server-only env var. `vite-plugin-pwa` won't include it because nothing in `src/` references it.
- ❌ Adding a DB. The starter is stateless. If the user needs persistence, suggest Vercel KV / Cloudflare D1 / Postgres explicitly.
- ❌ Removing the BFF to "make it a real SPA." See "Why this shape" above.

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
3. SPA re-mounts → `GET /api/me` → 200 with `{username, balance, grantedScopes}` → render `<GenerateForm>`.
4. User clicks "Preview Buzz cost" → `POST /api/generate/estimate` → display cost.
5. User clicks "Generate" → `POST /api/generate` → returns `workflowId` → SPA polls `GET /api/workflow/[id]` every 2s.
6. On terminal status → display image blobs from `steps[0].output.blobs`.
