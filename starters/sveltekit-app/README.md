# Civitai SvelteKit Starter

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-ff3e00.svg)](https://kit.svelte.dev)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcivitai%2Fcivitai-app-starters%2Ftree%2Fmain%2Fstarters%2Fsveltekit-app&env=CIVITAI_CLIENT_ID,CIVITAI_CLIENT_SECRET,SESSION_SECRET,APP_URL&envDescription=Civitai+OAuth+App+credentials+%2B+a+32-byte+session+secret&envLink=https%3A%2F%2Fdeveloper.civitai.com%2Fdocs%2Foauth&project-name=civitai-sveltekit-app&repository-name=civitai-sveltekit-app)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https%3A%2F%2Fgithub.com%2Fcivitai%2Fcivitai-app-starters&base=starters%2Fsveltekit-app)

Minimal SvelteKit 2 starter for building [Civitai](https://civitai.com) apps. Includes OAuth login, encrypted-cookie sessions, Buzz balance, cost preview, and a single image generation flow.

Built on the [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk) package, which wraps Civitai's OAuth + orchestrator endpoints.

## Getting started

```bash
npx tiged civitai/civitai-app-starters/starters/sveltekit-app my-app
cd my-app
cp .env.example .env
# Fill in CIVITAI_CLIENT_ID, CIVITAI_CLIENT_SECRET, SESSION_SECRET
pnpm install
pnpm dev
```

Open <http://localhost:5173>.

### Register a Civitai OAuth App

1. Go to <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. Client type: **Confidential (server-side app)**.
3. Grants: `authorization_code`, `refresh_token`.
4. Redirect URI: `http://localhost:5173/api/auth/callback/civitai`.
5. Scopes (minimum for the demo): `UserRead`, `AIServicesRead`, `AIServicesWrite`, `BuzzRead`.

Generate `SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## What's in the demo

- `/` — login button when logged out; balance + prompt form when logged in.
- `POST /api/auth/login` — PKCE handshake + redirect to Civitai authorize.
- `GET /api/auth/callback/civitai` — code exchange + session seal.
- `POST /api/auth/logout` — clear session.
- `POST /api/auth/revoke` — revoke tokens at Civitai then clear.
- `POST /api/generate/estimate` — `whatif=true` cost preview.
- `POST /api/generate` — real submission.
- `GET /api/workflow/[id]` — snapshot for client polling.

`src/hooks.server.ts` populates `event.locals.session` for every request — server routes read it instead of reaching into cookies directly.

## End-to-end tests

Playwright suite under `e2e/` exercises the full OAuth + cost-preview flow. Requires a Civitai instance that exposes a dev-only `testing-login` credentials provider — typically your own Civitai dev server, not production.

```bash
pnpm test:e2e:install   # one-time Chromium fetch
CIVITAI_BASE_URL=https://your-civitai-dev APP_URL=http://localhost:5173 TEST_USER_ID=1 \
  NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm test:e2e
```

Prereqs:

- Civitai dev instance with an OAuth app registered (redirect URI = `${APP_URL}/api/auth/callback/civitai`).
- `.env` filled in and `pnpm dev` running.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` only for self-signed dev TLS hosts.

## How to extend

See [`AGENTS.md`](./AGENTS.md). No DB, no Redis — edit one file to change scopes, model, or payload.

## License

[MIT](./LICENSE)
