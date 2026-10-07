# Civitai App examples

Six minimal, runnable Civitai App examples — one per feature area. Each is
self-contained (its own `block.manifest.json`, `src/`, and README) and runs
offline against the SDK's mock host, or against the real backend with
`dev:live`.

| Example | Feature | Key hooks / APIs | Gotchas baked in |
|---|---|---|---|
| [`hello-world`](./hello-world) | lifecycle | `useBlockContext`, `useBlockResize` | #60 (the block themes itself), trust frame |
| [`settings`](./settings) | manifest settings | `useBlockContext().settings`, `SettingsForm` (`/ui`) | publisher vs viewer scope, defaults the host doesn't fill |
| [`buzz-workflow`](./buzz-workflow) | generation + Buzz | `useBuzzWorkflow`, `WorkflowEstimateError` | #59 (estimate=submit seed), #8/#9/#10 (status + polling), #19 (/64 dims) |
| [`kv-storage`](./kv-storage) | per-block datastore | `useAppStorage` | storage scopes enforced locally, quota + per-value cap, anon handling |
| [`scopes-api`](./scopes-api) | scopes + REST | `useBlockToken`, `useHostOrigin`, direct `fetch` | declared vs granted scopes, 401→refresh→retry |
| [`buzz-purchase`](./buzz-purchase) | top-up | `useBuzzPurchase`, `useBuzzBalance`, `estimate` | a purchase raises the wallet, never the per-generation budget |
| [`generation-kinds`](./generation-kinds) | other `WorkflowBody` kinds (page app) | `useBuzzWorkflow` with `customComfy` + `step`/`chat-completion`, `useWildcardPack`, `useRequestConsent` | both kinds page-only, `page.buzzBudgetPerGen` ≥ the recipe ceiling, chat text only on the poll; `training` not available to apps yet |

## What every example shares

These are the current block conventions, the same as
[`civitai-block-starter`](../civitai-block-starter) and the `civitai app init`
templates. Copy them along with the feature you came for.

- **Dark first.** `index.html` declares `color-scheme: dark light`, paints a dark
  page before any script runs, and reads the host's theme from the
  `#civitai-block=v1&theme=…` URL fragment; `src/App.tsx` then keeps `<html>`'s
  `data-theme` in step with `BLOCK_INIT` and every `THEME_CHANGE`. The viewer's
  OS preference is never consulted.
- **Boot skeleton.** `"bootSkeleton": true` in the manifest, paired with the
  skeleton markup inside `#root` in `index.html` — the host drops its own
  loading veil for a block that declares it.
- **Design system.** Components from `@civitai/blocks-react/ui` (`Card`,
  `Stack`, `Button`, `TextInput`, `Alert`, …) and the `--civitai-*` tokens they
  inject, so a block looks like Civitai in both themes with no hex colours of its
  own. `src/main.tsx` calls `injectBlocksStyles()` before the first render.
- **`<BlockGate>`** wraps the production render: opening the block's URL
  directly shows an "Open on Civitai" card instead of hanging on "Loading…".
- **`src/Harness.tsx`** mounts the SDK's mock host (`Harness` from
  `@civitai/blocks-react/testing`) with the manifest's `scopes` as
  `declaredScopes`, so a scope the manifest forgot fails locally the way it
  fails in production; or, under `dev:live`, the live host
  (`@civitai/blocks-react/live`).

## Running any example

Copied out on its own — the way you start a real app from one:

```bash
npx tiged civitai/civitai-app-starters/starters/examples/<example> my-block
cd my-block
npm install
npm run dev:harness    # → http://localhost:518x (each example pins its own port)
```

Inside this monorepo, `pnpm install` at the root instead, then
`pnpm dev:harness` in the example's directory.

The mock host takes URL knobs — `?theme=light`, `?viewer=anon`,
`?consent=granted`, … (`readMockHostUrlOptions` in
`@civitai/blocks-react/testing`). The harness trusts the dev server's own
origin, so no `.env` is needed for it.

### Against the real backend: `dev:live`

```bash
civitai app dev-token <your-app-slug> --env >> .env.development.local
npm run dev:live
```

The same block, with the SDK's live host forwarding the bridge to Civitai
(through the dev server's `/api` proxy in `vite.config.ts`). ⚠️ It spends
**your own real Buzz** on a real generation. The token is minted for an app you
submitted, is short-lived, and lives in the git-ignored
`.env.development.local` — never in `.env.example`, which `civitai app submit`
uploads. Some host capabilities are refused in live mode rather than faked (a
Buzz purchase, for one); the list is the header of `@civitai/blocks-react`'s
`src/internal/liveHost.ts`.

## Shipping any example

Submit with the Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli))
— after a one-time `civitai login`:

```bash
civitai app validate    # check the manifest
civitai app submit      # validate, package, and upload for review
```

`civitai app submit` packages the example directory and uploads it for review
with your stored token. The platform owns the build + serve recipe — it injects
its own build (you don't ship a `Dockerfile` or `nginx.conf`), serves your
`dist/`, and stamps the block's `iframe.src` server-side. (With no token, the CLI
writes the `.zip` and you can web-upload it at `/apps/submit`.) See the
[end-to-end guide](../../docs/build-your-first-app-block.md).

## Notes

- Each example pins the PUBLISHED `@civitai/app-sdk` / `@civitai/blocks-react`
  caret ranges, so a copied-out example installs as-is. Inside this monorepo the
  root `pnpm.overrides` resolves those ranges to the local package source
  instead, so the examples always build against the code beside them.
- Each example commits a `package-lock.json` and sets `buildCommand` /
  `outputDir` in its manifest. The platform build installs strictly from the
  committed lockfile (`npm ci`), so `civitai app validate` refuses a project
  with a `package.json` and no lockfile. Run `npm install` after you change a
  dependency and commit the lockfile it writes.
- CI typechecks and builds every example, runs `civitai app validate
  --strict` on each one both in place and on a copy of only its tracked files
  (`scripts/check-examples-validate.mjs`), and boots each under `dev:harness` in
  Chromium to check it renders, logs no error, and paints the host's theme
  (`scripts/check-examples-render.mjs`).
- `buzz-workflow`'s Cancel is a real server-side cancel (`cancel(workflowId)`
  asks the host to stop the workflow on the orchestrator, gotcha #51), not just
  a client-side untrack.
