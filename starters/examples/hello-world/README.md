# hello-world — App Block lifecycle

The smallest complete App Block. Read this first.

## What it shows

| Concept | Where |
|---|---|
| `useBlockContext()` — slot context, viewer, theme, ids | `src/App.tsx` |
| The `ready` gate (fields are sentinel-empty before BLOCK_INIT) | `src/App.tsx` |
| `useBlockResize(ref)` — host fits the iframe to content | `src/App.tsx` |
| The host **trust frame** (drawn by civitai.com around the iframe) | conceptual — see below |
| **GOTCHA #60** — the block sets `data-theme` on its own root | `src/App.tsx` + `src/index.css` |

## The lifecycle

1. civitai.com renders an `<iframe>` at the URL the platform assigns your block
   (it stamps `iframe.src` server-side at approve — you don't set it), wrapped in
   a host-drawn **trust frame** (a bordered chrome bar with a "Civitai App
   block" badge + a ⋯ menu). That frame is rendered by the host, *outside* the
   iframe, so a sandboxed block can't fake, restyle, or hide it. **Don't draw
   your own outer border** — you'd just double the host's.
2. The host waits for the iframe `load` event AND a minted block JWT, then posts
   `BLOCK_INIT` with the context, viewer, theme, settings, and token.
3. `useBlockContext()` flips `ready` true and your UI renders.
4. `useBlockResize` posts `RESIZE_IFRAME` so the host sizes the iframe to fit.

## GOTCHA #60 — theming is the block's job

The host hands you `theme` (`'light' | 'dark'`) in `BLOCK_INIT`, but it **cannot
set `data-theme` inside your iframe** — that's a cross-document boundary. So:

- Inline-style anything you can: `color: theme === 'dark' ? '#e6e6e6' : '#1a1a1a'`.
- For what you *can't* inline-style — `::before`/`::after` pseudo-elements,
  `:hover`/`:focus` states — set `data-theme={theme}` on your root element and
  key the CSS off `[data-theme='dark'] …` (see `src/index.css`).

If you forget, every `[data-theme='dark']` rule is silently dormant and the
block renders in light mode on a dark host page.

## Run it locally

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5180 with a mock host
```

The harness (`src/Harness.tsx`) simulates the host: it posts a fake
`BLOCK_INIT` (here with `theme: 'dark'` so you can see #60 working), intercepts
your outbound messages into a debug log, and echoes token refreshes.

> The harness pins the parent origin to `http://localhost:5180` and so does
> `.env`. They must match (gotcha #53) or `BLOCK_INIT` is origin-rejected and
> the block hangs on "Loading…".

## Build + ship

```bash
pnpm build          # → dist/ (static SPA, base '/')
```

The platform owns the build + serve recipe: it injects its own build (you don't
ship a `Dockerfile` or `nginx.conf`), serves your `dist/`, and stamps the
block's `iframe.src` server-side. To publish, use the Go **`civitai` CLI**
([github.com/civitai/cli](https://github.com/civitai/cli)): after `civitai login`,
run `civitai app validate` then `civitai app submit` — it packages this directory
and uploads it for review. A moderator reviews it at `/apps/review`, and on
approve the build + deploy chain runs automatically. You never touch git hosting
directly. (With no token, the CLI writes the `.zip` and you can web-upload it at
`/apps/submit`.) See the [root README](../../../README.md) for the full
submit → review → deploy lifecycle.
