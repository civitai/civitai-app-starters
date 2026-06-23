# Agent Guide — Civitai App Starters

You're looking at a monorepo of starter templates for building apps on [Civitai](https://civitai.com), plus the shared `@civitai/app-sdk` and `@civitai/blocks-react` packages they depend on. Scaffolding, validation, and submit are handled by the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)) (`civitai login` + `civitai app init/validate/submit`); the local dev loop is the scaffolded project's own `npm run dev:harness`. The old `@civitai/blocks-cli` npm package is deprecated.

If you (the AI agent) were pointed here to scaffold a new Civitai app for your user, **do not clone this whole repo**. Pick one starter and pull just that subfolder.

## Pick a starter

| Use this when… | Starter |
|---|---|
| Building an **App Block** — iframe-embedded UI that renders inside a civitai.com page slot | `starters/civitai-block-starter` (scaffold with `civitai app init <name>` — the Go [`civitai` CLI](https://github.com/civitai/cli)) |
| App needs SEO / public-discoverable pages — gallery, landing, marketplace | `starters/next-app` (default for standalone apps) |
| App needs SEO and the team prefers Svelte | `starters/sveltekit-app` |
| App is a tool, mini-game, focused gen UI, in-app extension — no SEO required | `starters/react-pwa` |
| Same as above but the team prefers Svelte | `starters/svelte-pwa` |
| Unsure | `starters/next-app` |

App Blocks are a different shape from the standalone-app starters: no OAuth flow of their own, no BFF, no session cookies. The host civitai.com page mints a short-lived block-scoped JWT and ships it to the iframe via `BLOCK_INIT`. See [`packages/civitai-app-sdk/src/blocks/`](./packages/civitai-app-sdk/src/blocks/) for the contract and [`packages/civitai-blocks-react/`](./packages/civitai-blocks-react/) for the hooks.

## Cloning standalone

```bash
npx tiged civitai/civitai-app-starters/starters/next-app my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev
```

After cloning, see the chosen starter's own `AGENTS.md` and `README.md` for the specifics.

## Patterns to keep

These are validated in production by Civitai's own apps. Don't rewrite them; extend them.

- **OAuth + SDK glue lives in `@civitai/app-sdk`.** PKCE, token exchange, refresh, revoke, encrypted-cookie sessions, scope bitmask, and the orchestrator-client factory are all there. Each starter has a ~30-line framework adapter that calls these primitives. If you find yourself reimplementing any of those, stop — use the package.
- **Token exchange runs server-side.** Even in the PWA starters, the BFF (a single Hono route) does the OAuth token exchange. The browser never sees `client_secret` or the raw access token — only an opaque `httpOnly` session cookie.
- **Encrypted-cookie sessions.** AES-256-CTR via `@civitai/app-sdk`'s `sealCookie` / `unsealCookie`. No JWT-in-localStorage. No external session store.
- **Buzz is the user's, not the developer's.** When a user authenticates with OAuth and your app submits a generation, the orchestrator debits **the user's Buzz** via their token. App developers don't front the cost. Show the user a cost preview (`estimateCost` from `@civitai/app-sdk` → calls `?whatif=true`) before submitting.
- **Scopes are bitmasks.** Request only what you need at consent time. For the standard image-generation demo: `AIServicesWrite | BuzzRead | UserRead`. Use the named constants from `@civitai/app-sdk/scopes`, not magic numbers.

## Patterns to avoid

- ❌ Putting `CIVITAI_CLIENT_SECRET` in any client-side bundle, manifest, or build artifact. It belongs in `.env` on the server side only.
- ❌ Putting `access_token` or `refresh_token` in `localStorage`, `sessionStorage`, or rendered HTML.
- ❌ Reimplementing the orchestrator fetch + body shape in each starter. Use `@civitai/app-sdk/orchestrator`'s `estimateWorkflow`, `submitWorkflow`, `getWorkflow`, `pollWorkflow`, and `buildTextToImageBody`.
- ❌ Adding Redis, Postgres, or any external session store. The starters are designed to deploy as a single static bundle + (for PWAs) a single edge function. Don't add stateful infra.
- ❌ Hardcoding the orchestrator URL or scope bitmask values. Use `@civitai/app-sdk`'s constants.
- ❌ Replacing the OAuth flow with a "just store an API key" shortcut. API keys spend *the key owner's* Buzz, not the end user's — that's the wrong tenant model for a third-party app.

## Where to extend

Each starter ships a deliberately minimal demo (login + balance + cost preview + one generation + display). When the user asks you to add features:

- **New API call against Civitai** → if it'll be reused across starters, add a helper next to `@civitai/app-sdk/src/orchestrator/` (or a new sibling module). Otherwise inline in the starter using `callOrchestrator` from `@civitai/app-sdk/orchestrator`.
- **New page / route** → follow the framework's idioms (App Router for `next-app`, `+page.svelte` for `sveltekit-app`, etc.). Keep auth gating consistent with the existing pattern in each starter.
- **Persistence (saved generations, user prefs)** → starters intentionally don't include a database. If the app needs persistence, suggest adding one (recommend the framework-native choice — Vercel KV, Cloudflare D1, etc.) but flag it as **net-new infra**.

## Repo layout

```
civitai-app-starters/
├── packages/
│   ├── civitai-app-sdk/         # shared OAuth + SDK glue + framework-agnostic blocks contract
│   └── civitai-blocks-react/    # React hooks + iframe transport for Civitai App Blocks
└── starters/
    ├── next-app/                # Next.js 15 App Router (SSR)
    ├── sveltekit-app/           # SvelteKit 2 (SSR)
    ├── react-pwa/               # Vite + React 19 (SPA + Hono BFF)
    └── svelte-pwa/              # Vite + Svelte 5 (SPA + Hono BFF)
```

## Releasing a new SDK version

`@civitai/app-sdk` ships via [changesets](https://github.com/changesets/changesets) + a GitHub Actions workflow with npm OIDC trusted publishing. The maintainer flow is a one-liner:

```bash
pnpm changeset      # describe the bump; commit the generated .changeset/*.md
```

Merge to `main` → review the auto-generated *Version Packages* PR → merge it → npm publish runs in CI with no token, no OTP. Full flow: [`RELEASING.md`](./RELEASING.md).

## See also

- Per-starter `AGENTS.md` files for stack-specific guidance.
- [`packages/civitai-app-sdk/README.md`](./packages/civitai-app-sdk/README.md) — full SDK API reference.
- [`packages/civitai-blocks-react/README.md`](./packages/civitai-blocks-react/README.md) — React hooks + iframe transport for App Blocks.
- [`RELEASING.md`](./RELEASING.md) — SDK publish + changeset workflow.
- [Civitai OAuth quickstart](https://developer.civitai.com/docs/oauth) — official upstream docs.
