# Civitai App examples

Six minimal, runnable Civitai App examples — one per feature area. Each is
self-contained (its own `block.manifest.json`, `src/`, and README) and runs
offline via a dev harness that simulates the civitai.com host.

| Example | Feature | Key hooks / APIs | Gotchas baked in |
|---|---|---|---|
| [`hello-world`](./hello-world) | lifecycle | `useBlockContext`, `useBlockResize` | #60 (self-set `data-theme`), trust frame |
| [`settings`](./settings) | manifest settings | `useBlockSettings`, `SettingsForm` (`/ui`) | publisher vs viewer scope |
| [`buzz-workflow`](./buzz-workflow) | generation + Buzz | `useBuzzWorkflow` | #59 (estimate=submit seed), #8/#9/#10 (status + polling), #19 (/64 dims) |
| [`kv-storage`](./kv-storage) | per-block datastore | `useAppStorage` | quota + per-value cap, anon handling |
| [`scopes-api`](./scopes-api) | scopes + REST | `useBlockToken`, direct `fetch` | declared vs granted scopes, 401→refresh→retry |
| [`buzz-purchase`](./buzz-purchase) | top-up | `useBuzzPurchase` | insufficient-budget recovery |

## Running any example

Copied out on its own — the way you start a real app from one:

```bash
npx tiged civitai/civitai-app-starters/starters/examples/<example> my-block
cd my-block
cp .env.example .env
npm install
npm run dev:harness    # → http://localhost:518x (each example pins its own port)
```

Inside this monorepo, `pnpm install` at the root instead, then
`pnpm dev:harness` in the example's directory.

> The harness pins the parent origin to the example's dev-server origin, and
> `.env` matches it. They must stay in sync (gotcha #53) or `BLOCK_INIT` is
> origin-rejected and the block hangs on "Loading…".

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
- CI typechecks and builds every example, and runs `civitai app validate
  --strict` on each one both in place and on a copy of only its tracked files
  (`scripts/check-examples-validate.mjs`).
- `buzz-workflow`'s Cancel is a real server-side cancel (`cancel(workflowId)`
  asks the host to stop the workflow on the orchestrator, gotcha #51), not just
  a client-side untrack.
