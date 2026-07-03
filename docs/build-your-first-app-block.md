# Build your first App

End-to-end: from nothing to a block live in a civitai.com model sidebar. ~20
minutes. By the end you'll understand the four phases — **build → submit →
review → deploy** — and the handful of gotchas that trip up first-timers.

> **Civitai Apps is in a limited, moderator-gated preview (pre-GA).** Submission is
> restricted to enrolled/approved accounts while the feature is dark. You can
> install the CLI, scaffold, and run a block locally today — but `civitai app
> submit` requires Civitai Apps access, and an un-enrolled account can't get a
> block reviewed/approved (so it won't go live) until the feature opens up.
> There is no public self-serve "request access" form yet — watch
> [civitai.com](https://civitai.com) and the
> [civitai/cli issues](https://github.com/civitai/cli/issues) for the general-
> availability announcement.

## 0. Install + log in

Scaffolding, validation, and submission are handled by the Go **`civitai` CLI**
([github.com/civitai/cli](https://github.com/civitai/cli)). Install it once:

```bash
# Go install (Go 1.25+)
go install github.com/civitai/cli/cmd/civitai@latest
# …or download a prebuilt binary from https://github.com/civitai/cli/releases
civitai version
```

(Or, on macOS/Linux with Homebrew: `brew install civitai/tap/civitai`.) Then
authenticate once (browser device login):

```bash
civitai login        # or `civitai login --token <key>` for a personal API key
```

> The old `@civitai/blocks-cli` npm scaffolder is **deprecated** — use the Go
> `civitai` CLI ([github.com/civitai/cli](https://github.com/civitai/cli))
> instead, which is a superset of it.

## What a Civitai App is

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

Scaffolding is handled by the Go **`civitai` CLI**
([github.com/civitai/cli](https://github.com/civitai/cli)) — you installed it in
§0:

```bash
civitai app create my-block   # batteries-included page-money template
# (or `civitai app init my-block` for a no-build static template)
cd my-block
cp .env.example .env
pnpm install
```

The scaffolder writes a correct `block.manifest.json`; you then edit it by hand
to set your slot and content rating (the manifest is the source of truth — see
§2). Pick the template that fits: `--template static | page-vite | page-money`
(`create` defaults to `page-money`, `init` defaults to `static`).

Or copy one of the [examples](../starters/examples) that's closest to what you're
building (`hello-world` for a static UI, `buzz-workflow` for a generator).

This gives you:

```
my-block/
├── block.manifest.json   # what you register — slot + scopes (NOT iframe.src; the platform stamps it)
├── index.html
├── vite.config.ts        # base: '/'  (important — see §6)
└── src/                  # no Dockerfile/nginx.conf — the platform injects its own build at approve
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
  "blockId": "my-block",            // /^[a-z][a-z0-9-]*[a-z0-9]$/, 3–40 chars — also your subdomain
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
// @ts-skip-readme: imports a project-local ./block.manifest.json that doesn't exist in isolation
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
# (the Go CLI has no `dev` command — run the project's own dev script)
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
| **iframe.src** | Don't set it — the platform stamps it server-side at approve (`https://<blockId>.civit.ai/`, root-served). Keep Vite `base: '/'`. | The block is served at the subdomain root with no path prefix; a stale `base` makes the bundle 404 its own assets. |
| **runtime image** | You don't ship a `Dockerfile`/`nginx.conf` — the platform injects its own (non-root) build + serve recipe at approve. | The platform owns the runtime so every block runs the same hardened image; a tenant Dockerfile is stripped at approve. |
| **minHeight** | Set `iframe.minHeight` to the block's real rendered height. | A too-small value makes the iframe seed short and grow-jump on `BLOCK_READY` (layout shift). Measure it in the harness. |

And for generators specifically: your **estimate must build params identically to
submit** (esp. the seed), or the quoted cost won't match the charge — see the
`buzz-workflow` example.

## 7. Submit

Use the Go CLI (after `civitai login`):

```bash
civitai app validate    # checks the manifest before you ship
civitai app submit      # validates, ZIPs the project, and uploads it for review
```

`civitai app submit` bundles the project (`block.manifest.json`, `index.html`,
`src/`, `package.json`, `vite.config.ts` — excluding `node_modules`, `dist`,
`.env`, and any `Dockerfile`/`nginx.conf`; the platform injects its own build)
and uploads it. You're then redirected to **`/apps/my-submissions`** with status
`pending`.

Prefer the web UI? You can still ZIP the project yourself and attach it at
**`/apps/submit`** on civitai.com — the page parses your manifest client-side and
shows a preview card.

## 8. Review + deploy (automatic after approve)

A moderator reviews your submission at `/apps/review` (manifest + file diff) and:

- **Approves** → on the **first** version the platform auto-creates your
  OauthClient (`allowedOrigins=[https://<blockId>.civit.ai]`) and a private git
  repo, commits your files, and fires the build chain: inject the platform build
  recipe → build the image → push it → deploy (Deployment + Service +
  IngressRoute) → stamp `iframe.src` + program the `<blockId>.civit.ai` DNS
  record. Within ~5 min your block serves live. Your
  submission flips to `approved` with an "Open live" button.
- **Rejects** (with a reason) → you see the reason inline on `/apps/my-submissions`,
  fix, and resubmit.

**Subsequent versions**: bump `version`, re-ZIP, submit again. Approve updates the
existing app + repo (no new OauthClient) and re-runs the build.

## What you did NOT have to do

No git hosting, no Docker registry, no Kubernetes, no DNS, no OAuth client setup —
the platform does all of it on approve. You ship a ZIP; civitai.com does the rest.

## Next steps

- [`@civitai/blocks-react`](https://www.npmjs.com/package/@civitai/blocks-react) — every hook with a snippet ([source](../packages/civitai-blocks-react)).
- [`@civitai/app-sdk` /blocks](https://www.npmjs.com/package/@civitai/app-sdk) — the message/manifest contract + validator rules ([source](../packages/civitai-app-sdk)).
- The [examples](../starters/examples) — copy the one closest to your block.
