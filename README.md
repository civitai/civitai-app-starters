# Civitai App Starters

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-f69220.svg)](https://pnpm.io)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

Starter templates for building apps on [Civitai](https://civitai.com), plus the shared `@civitai/app-sdk` package they all use.

## What's in here

- **`packages/civitai-app-sdk`** — OAuth + PKCE, encrypted-cookie sessions, scope helpers, and orchestrator-call helpers. Every starter depends on this. Published to npm as `@civitai/app-sdk`.
- **`starters/next-app`** — Next.js 15 (App Router) + Tailwind. SSR-friendly, SEO-capable. Best default.
- **`starters/sveltekit-app`** — SvelteKit 2 + Tailwind. Same demo surface as `next-app`.
- **`starters/react-pwa`** — Vite + React 19 + tiny Hono BFF for OAuth token exchange. SPA/PWA shape — use for tools, games, focused gen UIs that don't need SEO.
- **`starters/svelte-pwa`** — Vite + bare Svelte 5 (no Kit) + tiny Hono BFF. SPA/PWA shape, Svelte audience that prefers not to use Kit.

All four ship the **same minimal demo:** log in via Civitai OAuth → show your Buzz balance → preview cost of a generation (`whatif`) → submit one image generation → display the result.

## Pick a starter

| Need | Use |
|---|---|
| Discoverable via search engines | `next-app` (default) or `sveltekit-app` |
| Tool, mini-game, focused UI, no SEO | `react-pwa` or `svelte-pwa` |
| Don't know / mainstream stack | `next-app` |

## Clone just one starter (recommended)

You almost never want to clone the whole monorepo. Pull just the starter you need:

```bash
npx tiged civitai/civitai-app-starters/starters/next-app my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev
```

Then:

1. Go to [civitai.com/user/account](https://civitai.com/user/account) → **OAuth Apps** → **Create**.
2. For SSR starters (`next-app`, `sveltekit-app`): client type **Confidential**.
3. For PWA starters (`react-pwa`, `svelte-pwa`): client type **Confidential** still — the BFF holds the secret. (Public-client browser-only flow is on the roadmap for a future `*-static` variant.)
4. Redirect URI: `http://localhost:3000/api/auth/callback/civitai` (varies per starter — see each starter's README).
5. Copy `CIVITAI_CLIENT_ID` and `CIVITAI_CLIENT_SECRET` into `.env`.
6. `pnpm dev`.

## Alternative ways to clone

```bash
# Next.js CLI native
npx create-next-app --example "https://github.com/civitai/civitai-app-starters/tree/main/starters/next-app" my-app

# Full repo + sparse-checkout (if you want git history)
git clone --filter=blob:none --sparse https://github.com/civitai/civitai-app-starters
cd civitai-app-starters && git sparse-checkout set --cone starters/next-app
```

## For AI coding agents

See [`AGENTS.md`](./AGENTS.md) at the root and the per-starter `AGENTS.md` inside each `starters/*`. The agent guides document which patterns to keep (auth + SDK lives in `@civitai/app-sdk`), which to avoid (don't put `client_secret` in the browser), and how the demo surface is structured.

## Working on the monorepo itself

```bash
pnpm install
pnpm build      # build all workspace packages
pnpm test       # run all package tests
pnpm typecheck  # type-check everything
```

### Releasing the SDK

`@civitai/app-sdk` ships via changesets + a GitHub Actions workflow with npm OIDC. After changing the SDK:

```bash
pnpm changeset           # author a changeset (patch / minor / major)
pnpm changeset status    # preview pending bumps
```

Merge the auto-opened *Version Packages* PR to publish. Full guide: [`RELEASING.md`](./RELEASING.md).

## License

[MIT](./LICENSE)
