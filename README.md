# Civitai App Starters

[![CI](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml/badge.svg)](https://github.com/civitai/civitai-app-starters/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-10-f69220.svg)](https://pnpm.io)
[![@civitai/app-sdk](https://img.shields.io/npm/v/@civitai/app-sdk.svg?label=%40civitai%2Fapp-sdk)](https://www.npmjs.com/package/@civitai/app-sdk)

Starter templates for building on [Civitai](https://civitai.com), plus the shared SDK packages they use. Two product surfaces live here:

1. **OAuth apps** — full apps on your own domain that sign in with Civitai and
   call the orchestrator. The four `starters/*` templates + `@civitai/app-sdk`.
2. **Civitai Apps** — iframe-embedded UIs that render *inside* civitai.com pages
   (e.g. a generator in a model's sidebar). The `@civitai/app-sdk/blocks`
   contract + `@civitai/blocks-react` hooks + the runnable
   [`starters/examples/*`](./starters/examples). **See [Civitai Apps](#civitai-apps)
   below.**

## What's in here

- **`packages/civitai-app-sdk`** — OAuth + PKCE, encrypted-cookie sessions, scope helpers, orchestrator-call helpers, AND the framework-agnostic **Civitai Apps** contract (`/blocks` subpath). Published to npm as `@civitai/app-sdk`.
- **`packages/civitai-blocks-react`** — React hooks + iframe transport for Civitai Apps. Published as `@civitai/blocks-react`.
- **Scaffolding + submit for Civitai Apps** — handled by the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)): `civitai login` → `civitai app init` / `civitai app validate` / `civitai app submit`. (Local dev is the scaffolded project's own `npm run dev:harness` / `npm run dev:live`.) The old `@civitai/blocks-cli` npm scaffolder it replaced stays published-but-deprecated on npm but is no longer part of this repo.
- **`starters/next-app`** — Next.js 15 (App Router) + Tailwind. SSR-friendly, SEO-capable. Best OAuth-app default.
- **`starters/sveltekit-app`** — SvelteKit 2 + Tailwind. Same demo surface as `next-app`.
- **`starters/react-pwa`** — Vite + React 19 + tiny Hono BFF for OAuth token exchange. SPA/PWA shape.
- **`starters/svelte-pwa`** — Vite + bare Svelte 5 (no Kit) + tiny Hono BFF. SPA/PWA shape.
- **`starters/civitai-block-starter`** — Vite + React 19 Civitai App scaffold (what `civitai app init` clones).
- **`starters/examples/*`** — six minimal, runnable Civitai App examples, one per feature (see [Civitai Apps](#civitai-apps)).

The four OAuth starters ship the **same minimal demo:** log in via Civitai OAuth → show your Buzz balance → preview cost of a generation (`whatif`) → submit one image generation → display the result.

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

## Civitai Apps

A **Civitai App** is a small iframe-embedded UI that renders inside a civitai.com
page — for example, a generator in a model's sidebar (`model.sidebar_top` slot).
Unlike an OAuth app, a block runs *inside* civitai.com and gets a short-lived,
block-scoped JWT + page context handed to it via `postMessage`. It's much smaller
than a full app: a single static SPA, no OAuth dance, no BFF.

### Packages

| Package | What |
|---|---|
| [`@civitai/app-sdk`](https://www.npmjs.com/package/@civitai/app-sdk) (`/blocks` subpath) — [source](./packages/civitai-app-sdk) | Framework-agnostic contract: manifest types, scopes, the `postMessage` protocol, `defineBlock` validator. |
| [`@civitai/blocks-react`](https://www.npmjs.com/package/@civitai/blocks-react) — [source](./packages/civitai-blocks-react) | React hooks (`useBlockContext`, `useBuzzWorkflow`, `useAppStorage`, …) + iframe transport. Plus `/ui` (the `SettingsForm`). |
| Go [`civitai` CLI](https://github.com/civitai/cli) | `civitai login` / `civitai app init` / `civitai app validate` / `civitai app submit` — scaffold and ship a block. (Local dev is the project's own `npm run dev:harness`.) Replaces the deprecated `@civitai/blocks-cli`. |

### Examples (start here)

Six minimal, runnable blocks under [`starters/examples/`](./starters/examples) —
one per feature, each with its own README. Each runs offline via a dev harness
that simulates the host.

| Example | Shows |
|---|---|
| [`hello-world`](./starters/examples/hello-world) | lifecycle: `useBlockContext`, the host trust frame, self-set `data-theme` |
| [`settings`](./starters/examples/settings) | manifest `settings` + the headless `SettingsForm`, publisher vs viewer scopes |
| [`buzz-workflow`](./starters/examples/buzz-workflow) | `useBuzzWorkflow` estimate→submit→poll, the cost-quote-matches-charge rule |
| [`kv-storage`](./starters/examples/kv-storage) | `useAppStorage` get/set/delete/list/getQuota |
| [`scopes-api`](./starters/examples/scopes-api) | declaring scopes + calling scope-gated REST with the BLOCK_INIT token |
| [`buzz-purchase`](./starters/examples/buzz-purchase) | `useBuzzPurchase` + the insufficient-budget flow |

### The dev → submit → review → deploy lifecycle

Devs never touch git hosting. The path is:

1. **Auth + Build** — `civitai login` once, scaffold with `civitai app init`,
   iterate locally with `npm run dev:harness` (mock host) or `npm run dev:live`
   (live host), `vite build` to a static `dist/`. Validate the manifest any time
   with `civitai app validate`.
2. **Submit** — `civitai app submit` validates, packages your project
   (`block.manifest.json` + `src/` + `index.html` + `package.json` +
   `vite.config.ts` + …), and uploads it for review with your stored token. You
   don't include a `Dockerfile` or `nginx.conf` — the platform injects its own
   build recipe at approve. (If you have no token configured, `submit` writes the
   `.zip` and prints next steps; you can also web-upload at `/apps/submit`.)
3. **Review** — a moderator reviews the manifest + file diff at **`/apps/review`**
   and approves (or rejects with a reason you see on `/apps/my-submissions`).
4. **Deploy** — on approve, the platform builds + serves your `dist/` and stamps
   the block's `iframe.src` server-side, serving it at
   **`https://<blockId>.civit.ai/`** (root-served). Within ~5 min your block is
   live in its slot.

→ **[Build your first App](./docs/build-your-first-app-block.md)** — the
end-to-end guide, from `civitai app init` to a live block.

### Gotchas worth knowing up front

These bit us building the reference block; the examples + the guide bake in the fixes:

- **Set `data-theme` on your own root** — the host can't inject it into your
  iframe, so any `[data-theme="dark"]` CSS is dormant until you do.
- **Your estimate must build params identically to submit** (esp. the seed) or
  the quoted Buzz cost won't match the charge.
- **The platform owns the runtime image + `iframe.src`** — you don't ship a
  `Dockerfile`/`nginx.conf` or set `iframe.src`; the platform injects the build
  and stamps the src (`https://<blockId>.civit.ai/`, root-served) at approve.
  Keep Vite `base: '/'` so the bundle resolves its own assets at the root.
- **The dev harness pins the parent origin** — serve on the matching origin or
  `BLOCK_INIT` is rejected and the block hangs on "Loading…".

## Porting an existing app

Already have an app and want to **add Sign-in-with-Civitai** or **swap your image-gen provider** for Civitai's orchestrator? See [`PORTING.md`](./PORTING.md) — step-by-step recipe for grafting the SDK into an existing codebase, with notes on both additive ("Civitai as one more provider") and full-replacement integration modes.

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
