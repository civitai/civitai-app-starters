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

```bash
cd <example>
cp .env.example .env
pnpm install
pnpm dev:harness    # → http://localhost:518x (each example pins its own port)
```

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

- These import `@civitai/app-sdk` / `@civitai/blocks-react` via `workspace:^`, so
  in this monorepo they build against the local package source. When you `tiged`
  one out standalone, swap to the published versions (`pnpm add @civitai/app-sdk
  @civitai/blocks-react`).
- The `cancel` call shown in `buzz-workflow` needs `@civitai/blocks-react@0.5.0+`
  (real server-side cancel, gotcha #51); the example does the client-side half so
  it compiles against any version.
