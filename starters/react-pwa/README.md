# Civitai React PWA Starter

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vitejs.dev)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/fork/github/civitai/civitai-app-starters/tree/main/starters/react-pwa)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fcivitai%2Fcivitai-app-starters)

Minimal Vite + React 19 PWA starter for Civitai apps. Includes OAuth login (via a tiny [Hono](https://hono.dev) BFF), encrypted-cookie sessions, Buzz balance, cost preview, and a single image generation flow.

Built on `@civitai/app-sdk`.

## Why a BFF?

OAuth confidential clients hold a `client_secret` that **must not** ship to the browser. This starter runs a small Hono server in the same project that:

- Performs the OAuth token exchange.
- Holds the refresh token in an `httpOnly` encrypted cookie.
- Proxies orchestrator calls so the access token never reaches the browser.

The SPA never sees a token — only the BFF does. In dev, Vite's dev server runs the Hono app via `@hono/vite-dev-server` on the same port. In prod, Node serves both the built SPA and the API.

## Getting started

```bash
npx tiged civitai/civitai-app-starters/starters/react-pwa my-app
cd my-app
cp .env.example .env
# Fill CIVITAI_CLIENT_ID, CIVITAI_CLIENT_SECRET, SESSION_SECRET
pnpm install
pnpm dev
```

Open <http://localhost:5174>.

### Register a Civitai OAuth App

1. <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. Client type: **Confidential**.
3. Grants: `authorization_code`, `refresh_token`.
4. Redirect URI: `http://localhost:5174/api/auth/callback/civitai`.
5. Scopes (minimum): `UserRead`, `AIServicesRead`, `AIServicesWrite`, `BuzzRead`.

Generate `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## File layout

```
react-pwa/
├── index.html
├── vite.config.ts         # React + Hono dev plugin + vite-plugin-pwa
├── server/                # Hono BFF (mounted at /api in dev & prod)
│   ├── app.ts             # routes
│   ├── index.ts           # prod entry (serves built SPA + API)
│   ├── env.ts, scopes.ts, session.ts, civitai.ts
└── src/                   # React SPA
    ├── main.tsx, App.tsx, index.css
    ├── components/        # LoginButton, LogoutControls, GenerateForm
    └── lib/               # api.ts (fetch helpers)
```

## Scripts

- `pnpm dev` — single port (5174 by default), Vite serves the SPA, Hono BFF handles `/api/*`.
- `pnpm build` — `vite build` for the SPA, `tsc -p tsconfig.server.json` for the BFF.
- `pnpm start` — production. Node + Hono serve `dist/` static + `/api`.
- `pnpm typecheck` — both tsconfigs.

## End-to-end tests

Playwright suite under `e2e/` exercises the full OAuth + cost-preview flow against a running Civitai instance that exposes the `testing-login` credentials provider (dev/test only — not available on production civitai.com).

```bash
pnpm test:e2e:install   # one-time Chromium fetch
CIVITAI_BASE_URL=https://your-civitai-dev APP_URL=http://localhost:5174 TEST_USER_ID=1 \
  NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm test:e2e
```

Prereqs: a Civitai instance with the test-login provider enabled, an OAuth app registered there (redirect URI = `${APP_URL}/api/auth/callback/civitai`), `.env` filled in, and `pnpm dev` running.

## Deploying

- Any Node host (Render, Fly, Railway, etc.): `pnpm build && pnpm start`.
- Vercel / Cloudflare Workers: swap `@hono/node-server` in `server/index.ts` for the matching adapter.
- On Workers, the cookie crypto (Node's `crypto` via `@civitai/app-sdk`) needs the `nodejs_compat` flag or a Web-Crypto-compatible shim.

## License

[MIT](./LICENSE)
