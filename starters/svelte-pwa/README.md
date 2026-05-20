# Civitai Svelte PWA Starter

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vitejs.dev)
[![Svelte](https://img.shields.io/badge/Svelte-5-ff3e00.svg)](https://svelte.dev)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/civitai/civitai-app-starters/tree/main/starters/svelte-pwa)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcivitai%2Fcivitai-app-starters)

Minimal Vite + bare Svelte 5 (no Kit) PWA for Civitai apps. OAuth login via a tiny [Hono](https://hono.dev) BFF, encrypted-cookie sessions, Buzz balance, cost preview, and a single image generation flow.

Pick this if you want Svelte runes without SvelteKit's conventions (load functions, `+page.svelte` routes, adapters). For SSR + Kit's routing, use [`sveltekit-app`](https://github.com/civitai/civitai-app-starters/tree/main/starters/sveltekit-app) instead.

## Getting started

```bash
npx tiged civitai/civitai-app-starters/starters/svelte-pwa my-app
cd my-app
cp .env.example .env
# Fill CIVITAI_CLIENT_ID, CIVITAI_CLIENT_SECRET, SESSION_SECRET
pnpm install
pnpm dev
```

Open <http://localhost:5175>.

### Register a Civitai OAuth App

1. <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. Client type: **Confidential**.
3. Grants: `authorization_code`, `refresh_token`.
4. Redirect URI: `http://localhost:5175/api/auth/callback/civitai`.
5. Scopes (minimum): `UserRead`, `AIServicesRead`, `AIServicesWrite`, `BuzzRead`.

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## File layout

```
svelte-pwa/
├── index.html
├── vite.config.ts          # svelte + @hono/vite-dev-server + VitePWA
├── svelte.config.js
├── server/                 # Hono BFF
│   ├── app.ts, index.ts, env.ts, scopes.ts, session.ts, civitai.ts
└── src/
    ├── main.ts, App.svelte, app.css
    ├── components/         # LoginButton, LogoutControls, GenerateForm (.svelte)
    └── lib/                # api.ts
```

## Scripts

- `pnpm dev` — Vite + Hono BFF on a single port (5175 by default).
- `pnpm build` — Vite SPA + `tsc -p tsconfig.server.json`.
- `pnpm start` — Node + Hono serves static `dist/` + `/api`.
- `pnpm typecheck` — `svelte-check` + server tsc.

## Extending

- **New Civitai API call:** add to `server/civitai.ts`, expose a route in `server/app.ts`, call from `src/lib/api.ts`.
- **More OAuth scopes:** edit `REQUESTED_SCOPES` in `server/scopes.ts`. Users re-consent on next login.
- **Different default model / generation engine:** edit `buildWorkflowBody` in `server/civitai.ts`.
- **Client-side routing:** drop in `svelte-spa-router` or a hash router. The BFF falls back to `index.html` for unmatched paths.
- **Deploy to Cloudflare Workers:** swap `@hono/node-server` for `@hono/cloudflare-workers` in `server/index.ts`. Cookie crypto uses Node's `crypto` — enable `nodejs_compat` or shim with Web Crypto.

## End-to-end tests

Playwright suite under `e2e/` exercises the full OAuth + cost-preview flow against a real Civitai dev server via the `testing-login` credentials provider (dev/test only).

```bash
pnpm test:e2e:install   # one-time Chromium fetch
CIVITAI_BASE_URL=https://your-civitai-dev APP_URL=http://localhost:5175 TEST_USER_ID=1 \
  NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm test:e2e
```

Prereqs: a running Civitai dev server with an OAuth app registered (redirect URI = `${APP_URL}/api/auth/callback/civitai`), `.env` filled in, and `pnpm dev` running.

## License

[MIT](./LICENSE)
