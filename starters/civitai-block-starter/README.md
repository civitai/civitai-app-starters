# Civitai App starter — web components

Scaffold for a [Civitai App](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks) — an iframe-embedded UI that renders on civitai.com pages — built with **web components and no UI framework**:

- **[`@civitai/sdk`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-sdk)** for the host bridge — `initialize()` waits for the host and hands you the slot context, viewer, theme and `app.host`.
- **[`@civitai/components`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-components)** `<civitai-*>` custom elements for the UI, themed by **[`@civitai/theme`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-theme)**'s `--civitai-*` tokens.
- Vite + TypeScript, nothing else.

Prefer React? Scaffold with the Go [`civitai` CLI](https://github.com/civitai/cli)
— `civitai app create <name>`, whose default `page-money` template is
Vite + React + TS — or start from one of the six React examples in
[`starters/examples/`](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples), which use the `@civitai/blocks-react` hooks.

> This is **not** the same as the OAuth-app starters (`next-app`, `react-pwa`, …).
> Those build a full third-party app with OAuth and a BFF. A *block* is much
> smaller: a single static SPA the host iframes into a slot on civitai.com, with
> the token + context handed in via `postMessage`.

## Quick start

```bash
npx tiged civitai/civitai-app-starters/starters/civitai-block-starter my-block
cd my-block
cp .env.example .env

npm install
npm run dev:harness
```

`npm run dev:harness` runs Vite at `http://localhost:5173` with a local dev
harness around your block. The harness simulates the host page — posts a fake
`BLOCK_INIT`, logs your outbound messages, and echoes token refreshes so the UI
iterates without civitai.com embedding your block.

## What runs in the iframe

```ts
import '@civitai/components/register'; // the generic <civitai-*> kit (see below for the rest)
import { initialize } from '@civitai/sdk';

const app = await initialize();               // resolves on the host's BLOCK_INIT
document.documentElement.dataset.theme = app.theme;
app.onChange(() => { /* theme, context, … changed — re-render */ });
app.host.autoResize(document.getElementById('root')!); // iframe follows content height
```

```html
<civitai-stack gap="sm">
  <civitai-text as="h2" size="md" weight="bold">Hello</civitai-text>
  <civitai-badge variant="light">signed in</civitai-badge>
</civitai-stack>
```

The whole demo is [`src/block.ts`](./src/block.ts). From the same `app` you also get
`app.site` (the `/api/v1` REST API as the viewer), `app.storage` /
`app.sharedStorage` (per-viewer and cross-viewer app storage),
`app.requestGrants(scopes)`, and the host's own UI via `app.host` — `navigate`,
`openResourcePicker`, `openBuzzPurchase`, `openImageUpload`,
`publishGenerationOutputs`, `requestSignIn`, `download`, `reportError`. The
[`@civitai/sdk` README](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-sdk#readme)
documents each.

🔴 **Running a generation from a block:** read the `@civitai/sdk` README's warning
before calling `app.orchestration` — a block submits through
`POST /api/v1/blocks/workflows/submit`, which carries the per-call Buzz budget,
daily caps and attribution that a direct orchestrator call skips.

The UI is the custom elements from [`@civitai/components`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-components)
— `<civitai-button>`, `<civitai-text-input>`, `<civitai-select>`,
`<civitai-modal>`, `<civitai-image>`, … Every tag, attribute, event and slot is
listed in the package's `custom-elements.json`. Which import defines which:

| Import | Defines |
|---|---|
| `@civitai/components/register` (what `src/block.ts` uses) | the generic kit — every element except the seven below |
| `@civitai/components/register-site` | the generic kit **plus** the civitai.com vocabulary: `<civitai-avatar>`, `<civitai-media-card>`, `<civitai-rating-badge>`, `<civitai-reaction>`, `<civitai-tag>` |
| `@civitai/components/civitai-sign-in-button/define`, `…/civitai-workflow-button/define` | the two SDK-backed elements, one import each — no register entry includes them |

An element nothing defines renders as an unstyled, inert tag with no error;
`test/block.test.ts` fails if the starter uses one.

## Direct loads

Opened top-level at its own `<slug>.civit.ai` URL (a shared link, a social
unfurl), no host ever sends `BLOCK_INIT`. After 2 s the block shows an "Open on
Civitai" card linking to `https://civitai.com/apps/run/<slug>` instead of a
skeleton that never resolves ([`src/directLoad.ts`](./src/directLoad.ts)). An
embedded block never shows it, however slow its host.

## Boot skeleton

`block.manifest.json` sets `"bootSkeleton": true` and `index.html` paints a
matching skeleton inside `#root`, styled by an inline `<style>` so it appears
before any script runs. **Ship them together.** The key makes the full-page run
host stand down its own loading UI; declared over an empty `#root` it is *worse*
than not opting in — a blank iframe for the whole load.

The skeleton is also this block's loading state: it stays until `BLOCK_INIT`
lands, and the first render's `root.replaceChildren(…)` removes it. Nothing else
does, so keep the skeleton *inside* `#root`.

The boot theme is the **host's**, not the OS's. Civitai apps default to dark and
never consult the browser preference: light engages only when the host says the
viewer chose it — via the `#civitai-block=v1&theme=…` URL fragment (an inline
script applies it before first paint), then `BLOCK_INIT`, then live
`THEME_CHANGE` pushes (synced onto `<html>` by `src/block.ts`).

This starter targets `model.sidebar_top` and declares no `page` surface, so the
key is inert until the app gains one. It is the scaffolded default so the markup
and the declaration are never introduced separately.

## Environment

| Variable | When | Purpose |
|---|---|---|
| `VITE_BLOCK_ALLOWED_PARENT_ORIGINS` | dev | Comma-separated parent origins the bridge accepts messages from. **In production the platform injects it at build time**, so the committed value only matters locally — point it at your dev-server origin for the harness. Unset, `@civitai/sdk` falls back to the canonical civitai.com origins. |
| `VITE_DEV_HARNESS` | dev only | `"true"` installs the local host simulator. `npm run dev:harness` sets it for you; production builds leave it unset, and the harness is then dropped from the bundle. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite at `http://localhost:5173`, no harness — for iterating against a real host page that iframes your dev URL. |
| `npm run dev:harness` | Same, with the local dev harness. **Use this for offline iteration.** |
| `npm run build` | Production bundle in `dist/`. Also validates `block.manifest.json`. |
| `npm run typecheck` | TypeScript strict check. |
| `npm test` | Drives the block through the real bridge in happy-dom ([`test/block.test.ts`](./test/block.test.ts)). |
| `npm run preview` | Serve the production bundle locally. |

There is no `dev:live` (run local code against the real backend) here yet: the
live-backend host is exported only from `@civitai/blocks-react/live`, which
requires React. Iterate with `dev:harness`, and test against the real backend by
submitting.

## Project layout

```
.
├── block.manifest.json    # what you register with civitai.com
├── index.html             # boot skeleton + pre-paint theme script
├── vite.config.ts         # blockManifestPlugin — validates the manifest on dev + build
├── src/
│   ├── main.ts            # entry: safe-storage, theme CSS, harness (dev), mountBlock
│   ├── block.ts           # your block: initialize → render → resize
│   ├── directLoad.ts      # the "Open on Civitai" fallback for top-level loads
│   ├── index.css
│   └── dev/
│       └── harness.ts     # the local host simulator
├── test/
│   └── block.test.ts      # the bridge test
└── .env.example
```

## Registering the block

Submit with the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)).
After a one-time `civitai login`, run `civitai app validate` then
`civitai app submit` — the latter validates, packages the project, and uploads it
for review; a moderator reviews and approves it. The platform owns the build +
serve recipe (you don't ship a `Dockerfile` or `nginx.conf`, or set
`iframe.src`) and serves your `dist/` at `https://<blockId>.civit.ai/`.

## See also

- [`@civitai/sdk`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-sdk) — the bridge and API client this starter uses.
- [`@civitai/components`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-components) — the `<civitai-*>` elements.
- [`@civitai/app-sdk/blocks`](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks) — the manifest types, scopes and the `isSignedIn` / `isModelSlotContext` predicates.
- [`AGENTS.md`](./AGENTS.md) — guidance for AI coding agents working inside this starter.
