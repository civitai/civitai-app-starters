# Build your first App Block

End-to-end: from nothing to a block live in a civitai.com model sidebar. ~20
minutes. By the end you'll understand the four phases — **build → submit →
review → deploy** — and the handful of gotchas that trip up first-timers.

## What an App Block is

A small iframe-embedded UI that renders *inside* a civitai.com page. The host
(civitai.com) draws a trust frame around your iframe, hands you a short-lived
block-scoped JWT plus the page context via `postMessage`, and mediates anything
privileged (generation, Buzz purchase, storage). You ship a single static SPA —
no OAuth dance, no backend.

```
civitai.com model page
└─ slot: model.sidebar_top
   └─ [ host trust frame: "Civitai App block" badge + ⋯ menu ]
      └─ <iframe src="https://my-block.civit.ai/">   ← YOUR block
```

## Prerequisites

- Node ≥ 20, pnpm.
- A Civitai account. (Publishing is moderated; you submit a ZIP and a moderator
  approves it — you don't need any infra access.)

## 1. Scaffold

```bash
npx @civitai/blocks-cli@latest init my-block \
  --block-id my-block \
  --slot model.sidebar_top \
  --content-rating pg
cd my-block
cp .env.example .env
pnpm install
```

Or copy one of the [examples](../starters/examples) that's closest to what you're
building (`hello-world` for a static UI, `buzz-workflow` for a generator).

This gives you:

```
my-block/
├── block.manifest.json   # what you register — slot, scopes, iframe url
├── index.html
├── vite.config.ts        # base: '/'  (important — see §6)
├── Dockerfile            # nginx-unprivileged (important — see §6)
├── nginx.conf
└── src/
    ├── App.tsx           # your UI
    ├── main.tsx
    └── Harness.tsx       # local host simulator (dev only)
```

## 2. The manifest

`block.manifest.json` is the contract. The fields that matter:

```jsonc
{
  "$schema": "https://civitai.com/schemas/app-block/v1.json",
  "appId": "app_REPLACE_ME",        // your OauthClient id (created on first approve)
  "blockId": "my-block",            // /^[a-z0-9-]{3,64}$/ — also your subdomain
  "version": "0.1.0",               // semver; bump on each new submission
  "name": "My Block",
  "type": "block",
  "targets": [
    { "slotId": "model.sidebar_top", "priority": 100,
      "requiredContext": ["modelId", "modelVersionId"] }
  ],
  "scopes": ["models:read:self"],   // non-empty; domain:verb:target lowercase
  "iframe": {
    "src": "https://my-block.civit.ai/",   // ROOT of <blockId>.civit.ai (§6)
    "minHeight": 240,                       // set to your REAL height (§6)
    "maxHeight": 600,
    "resizable": true,
    "sandbox": "allow-scripts allow-forms"  // NOT allow-same-origin / allow-top-navigation
  },
  "contentRating": "pg",
  "minApiVersion": "1.0"
}
```

Validate it any time with `defineBlock` (it throws with a `.field` path on the
first violation):

```ts
import { defineBlock } from '@civitai/app-sdk/blocks';
import manifest from './block.manifest.json' with { type: 'json' };
defineBlock({ manifest });   // call at module scope so mistakes throw at startup
```

## 3. Write the block

Read everything from the host with `useBlockContext()`; gate on `ready`:

```tsx
import { useRef } from 'react';
import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import type { ModelSlotContext } from '@civitai/app-sdk/blocks';

export function App() {
  const { ready, context, viewer, theme } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);             // host fits the iframe to content

  if (!ready) return <div ref={rootRef} data-theme={theme}>Loading…</div>;
  const model = context as ModelSlotContext;

  return (
    // GOTCHA: data-theme on YOUR root — the host can't set it inside the iframe.
    <div ref={rootRef} data-theme={theme}>
      Block for {model.modelName}, hi {viewer?.username ?? 'anon'}
    </div>
  );
}
```

To generate + bill Buzz, use `useBuzzWorkflow()` (estimate → submit → poll) — see
the [`buzz-workflow`](../starters/examples/buzz-workflow) example for the full
pattern including the cost-quote rule and the caller-driven poll loop.

## 4. Run it locally

```bash
pnpm dev:harness    # → http://localhost:<port> with a mock host
```

The harness (`src/Harness.tsx`) posts a fake `BLOCK_INIT`, intercepts your
outbound messages into a debug log, and echoes token refreshes — so you iterate
without civitai.com embedding your block.

> The harness pins the parent origin (e.g. `http://localhost:5180`) and so does
> `.env`. They MUST match, or the transport's origin allowlist drops `BLOCK_INIT`
> and the block hangs on "Loading…".

## 5. Build

```bash
pnpm build          # → dist/  (static SPA)
```

## 6. The four gotchas that block first deploys

| # | Rule | Why |
|---|---|---|
| **theme** | Set `data-theme={theme}` on your root. | The host can't reach into the iframe; `[data-theme=…]` CSS (pseudo-elements, `:hover`) is otherwise dormant. |
| **iframe.src** | `https://<blockId>.civit.ai/` (root) + Vite `base: '/'`. | The block is served at the subdomain root with no path prefix; submit rejects a non-root `src`, and a stale `base` makes the bundle 404 its own assets. |
| **runtime image** | `Dockerfile` uses `nginxinc/nginx-unprivileged:1.27-alpine`. | The deploy smoke step admits the pod under `runAsNonRoot`; plain `nginx:alpine` fails it and the deploy hangs. |
| **minHeight** | Set `iframe.minHeight` to the block's real rendered height. | A too-small value makes the iframe seed short and grow-jump on `BLOCK_READY` (layout shift). Measure it in the harness. |

And for generators specifically: your **estimate must build params identically to
submit** (esp. the seed), or the quoted cost won't match the charge — see the
`buzz-workflow` example.

## 7. Submit

1. ZIP your project directory (include the `Dockerfile`, `block.manifest.json`,
   `nginx.conf`, `index.html`, `src/`, `package.json`, `vite.config.ts` — exclude
   `node_modules`, `dist`, `.env`).
2. Go to **`/apps/submit`** on civitai.com. Attach the ZIP — the page parses your
   manifest client-side and shows a preview card. Click Submit.
3. You're redirected to **`/apps/my-submissions`** with status `pending`.

## 8. Review + deploy (automatic after approve)

A moderator reviews your submission at `/apps/review` (manifest + file diff) and:

- **Approves** → on the **first** version the platform auto-creates your
  OauthClient (`allowedOrigins=[https://<blockId>.civit.ai]`) and a private git
  repo, commits your files, and fires the build chain: build the Dockerfile →
  push the image → deploy (Deployment + Service + IngressRoute) → program the
  `<blockId>.civit.ai` DNS record. Within ~5 min your block serves live. Your
  submission flips to `approved` with an "Open live" button.
- **Rejects** (with a reason) → you see the reason inline on `/apps/my-submissions`,
  fix, and resubmit.

**Subsequent versions**: bump `version`, re-ZIP, submit again. Approve updates the
existing app + repo (no new OauthClient) and re-runs the build.

## What you did NOT have to do

No git hosting, no Docker registry, no Kubernetes, no DNS, no OAuth client setup —
the platform does all of it on approve. You ship a ZIP; civitai.com does the rest.

## Next steps

- [`@civitai/blocks-react`](../packages/civitai-blocks-react) — every hook with a snippet.
- [`@civitai/app-sdk` /blocks](../packages/civitai-app-sdk) — the message/manifest contract + validator rules.
- The [examples](../starters/examples) — copy the one closest to your block.
