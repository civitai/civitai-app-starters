# Civitai Next.js Starter

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcivitai%2Fcivitai-app-starters%2Ftree%2Fmain%2Fstarters%2Fnext-app&env=CIVITAI_CLIENT_ID,CIVITAI_CLIENT_SECRET,SESSION_SECRET,NEXT_PUBLIC_APP_URL&envDescription=Civitai+OAuth+App+credentials+%2B+a+32-byte+session+secret&envLink=https%3A%2F%2Fdeveloper.civitai.com%2Fdocs%2Foauth&project-name=civitai-next-app&repository-name=civitai-next-app)

Minimal Next.js 15 App Router starter for building [Civitai](https://civitai.com) apps. Includes OAuth login, encrypted-cookie sessions, Buzz balance, cost preview, and a single image generation flow.

Built on `@civitai/app-sdk` — see the [SDK README](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk#readme) for the underlying primitives.

## Getting started

```bash
# Pull just this starter (recommended)
npx tiged civitai/civitai-app-starters/starters/next-app my-app
cd my-app

cp .env.example .env
# Fill in CIVITAI_CLIENT_ID, CIVITAI_CLIENT_SECRET, SESSION_SECRET

pnpm install
pnpm dev
```

Open <http://localhost:3000>.

### Register a Civitai OAuth App

1. Go to <https://civitai.com/user/account> → **OAuth Apps** → **Create**.
2. Client type: **Confidential (server-side app)** — this starter holds the secret server-side.
3. Grants: `authorization_code`, `refresh_token`.
4. Redirect URI: `http://localhost:3000/api/auth/callback/civitai` (replace host for prod).
5. Scopes (minimum for the demo): `UserRead`, `AIServicesRead`, `AIServicesWrite`, `BuzzRead`.
6. Copy the **Client ID** and **Client Secret** into `.env`.

Generate `SESSION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## What's in the demo

- `/` — login button when logged out; balance + prompt form when logged in.
- `POST /api/auth/login` — generates PKCE pair, seals state cookie, redirects to Civitai.
- `GET /api/auth/callback/civitai` — exchanges code, seals session cookie.
- `POST /api/auth/logout` — clears session.
- `POST /api/auth/revoke` — revokes tokens at Civitai then clears session.
- `POST /api/generate/estimate` — calls `whatif=true` to preview Buzz cost.
- `POST /api/generate` — submits the workflow and debits the user's Buzz.
- `GET /api/workflow/[id]` — fetches a workflow snapshot (client polls this).

## How to extend

See [`AGENTS.md`](./AGENTS.md). Short version:

- **New API call** — add a function to `src/lib/civitai.ts` that uses the user's session.
- **New OAuth scope** — bump the constant in `src/lib/scopes.ts`. Users will re-consent on next login.
- **Persistent storage** — this starter is intentionally stateless. Add Vercel KV / Postgres / etc. if you need to remember things across sessions.

## End-to-end tests

A small Playwright suite under `e2e/` exercises the full OAuth flow against a real Civitai dev server using its `testing-login` credentials provider (dev/test only).

Prereqs:

1. Civitai dev server running locally (the `civitai/civitai` repo's `pnpm dev`).
2. This starter's dev server running (`pnpm dev`).
3. An OAuth app registered on that Civitai instance with the starter's `/api/auth/callback/civitai` URL as a registered redirect URI.
4. `.env` filled with that OAuth app's id/secret + `CIVITAI_BASE_URL` pointing at the dev Civitai.

Then:

```bash
pnpm test:e2e:install   # one-time: install Chromium for Playwright
CIVITAI_BASE_URL=http://localhost:3000 \
APP_URL=http://localhost:3333 \
TEST_USER_ID=1 \
pnpm test:e2e
```

Two specs are included:

- `e2e/auth-flow.spec.ts` — programmatically signs the test user in to Civitai via `testing-login`, drives the OAuth consent (or skips it on subsequent runs), and asserts the starter's signed-in UI shows up.
- `e2e/generation.spec.ts` — clicks **Preview Buzz cost**, asserts a `?whatif=true` price comes back. No Buzz is spent.

The tests **fail loudly** if `CIVITAI_BASE_URL` or `APP_URL` are unset. Aimed at local dev; running against prod requires a real browser-session auth (no `testing-login` available there).

## Deploying

Drop-in to Vercel: push the repo, set the four env vars in the Vercel dashboard, register the OAuth App's prod redirect URI. No DB, no Redis, no extra infra.

## License

[MIT](./LICENSE)
