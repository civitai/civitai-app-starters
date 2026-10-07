# hello-world — Civitai App lifecycle

The smallest complete Civitai App. Read this first.

## What it shows

| Concept | Where |
|---|---|
| `useBlockContext()` — slot context, viewer, theme, ids | `src/App.tsx` |
| The `ready` gate (fields are sentinel-empty before BLOCK_INIT) | `src/App.tsx` |
| `useBlockResize(ref)` — host fits the iframe to content | `src/App.tsx` |
| The host **trust frame** (drawn by civitai.com around the iframe) | conceptual — see below |
| **GOTCHA #60** — the block themes itself, dark first | `index.html` + `src/App.tsx` |
| `/ui` components (`Card`, `Stack`) on the `--civitai-*` tokens | `src/App.tsx`, `src/main.tsx` |
| `<BlockGate>` for a direct, unembedded load | `src/main.tsx` |

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

## GOTCHA #60 — theming is the block's job, and it starts dark

The host hands you `theme` (`'light' | 'dark'`), but it **cannot set anything
inside your iframe** — that's a cross-document boundary. civitai.com is dark,
and the block must not let the viewer's OS decide otherwise, so:

1. `index.html` declares `<meta name="color-scheme" content="dark light">`,
   paints a dark page in an inline `<style>`, and an inline script reads the
   host's `#civitai-block=v1&theme=…` URL fragment **before first paint**, so a
   light host is light from the first frame.
2. `src/App.tsx` sets `document.documentElement.dataset.theme` from
   `BLOCK_INIT` and again on every live `THEME_CHANGE` — but only once `ready`,
   because before `BLOCK_INIT` the value is a placeholder.
3. The `/ui` components and the `--civitai-*` tokens key off that attribute:
   dark by default, light under `[data-theme='light']`. No hex colours of your
   own needed.

What this replaces: `color-scheme: light dark` on a transparent page, which
painted a **white** block on a light-OS viewer while civitai.com was dark.

## Run it locally

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5180 with a mock host
```

`src/Harness.tsx` mounts the SDK's mock host (`Harness` from
`@civitai/blocks-react/testing`): it posts `BLOCK_INIT`, answers the block's
requests, and logs the outbound messages in a corner badge. Add `?theme=light`
to the URL for the light theme, `?viewer=anon` for an anonymous viewer.

`npm run dev:live` runs the same block against the real backend — see
[the examples README](../README.md#against-the-real-backend-devlive).

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
