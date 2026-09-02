# Civitai App — Vite + React starter

Scaffold for a [Civitai App](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks) — an iframe-embedded UI that renders on civitai.com pages and authenticates via short-lived block-scoped JWTs.

> This is **not** the same as the `react-pwa` starter. That one builds a full
> third-party app with OAuth and a BFF. A *block* is much smaller: a single
> SPA the host iframes into a slot on civitai.com, with the token + context
> handed in via `postMessage`.

## Quick start

```bash
npx tiged civitai/civitai-app-starters/starters/civitai-block-starter my-block
cd my-block
cp .env.example .env

pnpm install
pnpm dev:harness
```

`pnpm dev:harness` runs Vite at `http://localhost:5173` with a local dev
harness mounted around your block. The harness simulates the host page —
posts a fake `BLOCK_INIT`, intercepts your outbound messages, and echoes
token refreshes so the UI iterates without civitai.com embedding your block.

## What you ship

- **`block.manifest.json`** — registered with civitai.com. Declares the slot you target and the scopes you request. You do **not** set `iframe.src`: the platform stamps it server-side when your block is approved (and ignores/strips any `src` you include).
- **The Vite build output** (`pnpm build` → `dist/`) — submitted to civitai.com. The platform owns the build + serve recipe (it injects its own build; you don't ship a `Dockerfile` or `nginx.conf`) and serves your `dist/` at the URL it assigns. You don't self-host.

## What runs in the iframe

The block hooks read everything from the host via `BLOCK_INIT`:

```tsx
import { useBlockContext, useBlockResize } from '@civitai/blocks-react';

export function App() {
  const { ready, context, viewer, theme } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);   // host iframe shrinks/grows to fit content

  if (!ready) return <div>Loading…</div>;
  return <div ref={rootRef} data-theme={theme}>…</div>;
}
```

Other hooks ship with `@civitai/blocks-react`:

- `useBlockToken()` — current JWT + auto-refresh + `refresh()` for 401 retries
- `useBuzzWorkflow()` — `estimate` / `submit` / `poll` against orchestrator workflows
- `useBlockSettings()` — publisher + per-viewer settings (per-viewer is Phase 2)

`useBuzzPurchase`, `useCivitaiNavigate`, and `useBlockAnalytics` are exported
but the host-side handlers ship in Phase 2 of civitai.com's Civitai Apps
substrate — calls will reject on the per-request timeout until then.

## Boot skeleton

`block.manifest.json` sets `"bootSkeleton": true` and `index.html` paints a
matching skeleton inside `#root`, styled by an inline `<style>` so it appears
before any script runs. **Ship them together.** The key makes the full-page run
host stand down its own loading UI (no veil, iframe visible from mount); declared
over an empty `#root` it is *worse* than not opting in — a blank iframe for the
whole load, with the veil that used to cover it deliberately removed.

The boot theme is a **guess** from `prefers-color-scheme`, corrected when
`BLOCK_INIT` arrives. It defaults to **dark**: the base CSS rules carry the dark
values and light lives only in `@media (prefers-color-scheme: light)` — never the
other way round, or `no-preference` viewers get light.

Nothing removes the skeleton because React's `createRoot` clears the container on
its first render. That is React-specific — Svelte 5's `mount` appends and needs
an explicit `document.querySelector('[data-boot-skeleton]')?.remove()`.

Note: this starter targets `model.sidebar_top` and declares no `page` surface, so
the key is inert until the app gains one. It is the scaffolded default so the
markup and the declaration are never introduced separately.

## Environment

| Variable | When | Purpose |
|---|---|---|
| `VITE_BLOCK_ALLOWED_PARENT_ORIGINS` | always (build + dev) | Comma-separated list of allowed parent-frame origins. The `IframeTransport` drops every `postMessage` whose `event.origin` isn't in this list. **Required** — without it the transport refuses to mount. **In production this value is platform-injected at build time by the Civitai Apps build recipe** (it sets an `ENV` that Vite prioritizes over `.env` files), so the value you commit here only matters for **local dev** (point it at your dev-server origin). The injected prod set must mirror the host CSP `frame-ancestors` allowlist — both layers gate which parent domains may embed and message a block. |
| `VITE_DEV_HARNESS` | dev only | Set to `"true"` to wrap the block in the local simulator. `pnpm dev:harness` flips this on for you. Strip from production builds. |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite at `http://localhost:5173`, no harness — for iterating against a real host page that iframes your dev URL. |
| `pnpm dev:harness` | Same, with the local dev harness mounted. **Use this for offline iteration.** |
| `pnpm build` | Production bundle in `dist/`. |
| `pnpm typecheck` | TypeScript strict check. |
| `pnpm preview` | Serve the production bundle locally. |

## Project layout

```
.
├── block.manifest.json    # what you register with civitai.com
├── civitai.app.json       # legacy npm-CLI config (the Go `civitai` CLI reads only block.manifest.json)
├── index.html
├── vite.config.ts
├── src/
│   ├── App.tsx            # your block UI
│   ├── main.tsx           # mounts <App/> (wraps in <Harness/> when VITE_DEV_HARNESS=true)
│   ├── index.css
│   └── dev/
│       └── Harness.tsx    # the local simulator
└── .env.example
```

## Registering the block

The canonical path is the **submit → review → deploy** flow on civitai.com,
driven by the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)).
After a one-time `civitai login`, run `civitai app validate` then
`civitai app submit` — the latter validates, packages the project, and uploads it
for review with your stored token; a moderator reviews and approves it. (With no
token configured, `submit` writes the `.zip` and you can web-upload it at
`/apps/submit`.) The old `@civitai/blocks-cli` npm scaffolder is **deprecated** in
favor of this Go CLI.

## See also

- [`@civitai/app-sdk/blocks`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks) — the framework-agnostic contract (manifest types, scopes, postMessage protocol, JSON schema).
- [`@civitai/blocks-react`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-blocks-react) — the React hooks + iframe transport this starter consumes.
- [`AGENTS.md`](./AGENTS.md) — guidance for AI coding agents working inside this starter.
