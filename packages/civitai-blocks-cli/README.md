# `@civitai/blocks-cli`

Command-line tools for scaffolding and shipping [Civitai App Blocks](https://github.com/civitai/civitai-app-starters/tree/main/packages/civitai-app-sdk/src/blocks).

## Install

```bash
# One-off
npx @civitai/blocks-cli@latest init my-block

# Project-local (after init)
pnpm add -D @civitai/blocks-cli
```

## Commands

### `civitai init [destination]`

Scaffold a new block project from the [Vite + React starter](https://github.com/civitai/civitai-app-starters/tree/main/starters/civitai-block-starter). Shells out to `npx tiged` for the clone, then patches `block.manifest.json` + `civitai.app.json` with the values you supplied.

```bash
civitai init my-block \
  --block-id my-block \
  --app-id app_REPLACE_ME \
  --slot model.sidebar_top \
  --content-rating pg
```

Validation runs through `defineBlock` before any disk writes — bad inputs fail fast without leaving a half-scaffolded directory.

### `civitai dev`

Convenience for `pnpm dev:harness` — runs Vite with `VITE_DEV_HARNESS=true` set. Use from a scaffolded block project; users who know the harness flag can just run `pnpm dev:harness` directly.

```bash
civitai dev
civitai dev --port 5180
```

### `civitai deploy` (preflight only — not the publish path)

Runs the `defineBlock` validator over every manifest in
`civitai.app.json.blocks[]` (a useful local preflight), then prints a notice.
**It does not publish your block** — manifest registration is no longer a direct
API call from the CLI.

### `civitai bundle` / `civitai upload` / `civitai publish`

Reserved for v2 inline mode (host-rendered blocks loaded as static asset bundles
rather than embedded iframes). All print "coming soon" today.

## How the CLI maps to the publish flow

The canonical way to publish a block is the **submit → review → deploy** flow on
civitai.com — devs never touch git hosting:

1. **`civitai init`** scaffolds the project.
2. **`civitai dev`** (or `pnpm dev:harness`) iterates locally.
3. **`vite build`** produces the static bundle. (`civitai deploy` is just a
   preflight validation — there's no CLI publish step.)
4. **ZIP the project** (`block.manifest.json` + `src/` + `index.html` +
   `package.json` + `vite.config.ts` + …) and upload it at **`/apps/submit`** on
   civitai.com. No `Dockerfile`/`nginx.conf` — the platform injects its own build.
5. A **moderator reviews** it at `/apps/review`; on approve, the platform builds +
   serves your `dist/` and stamps `iframe.src`, serving your block at
   `https://<blockId>.civit.ai/`.

See the [root README](https://github.com/civitai/civitai-app-starters#readme) for
the full lifecycle and the [examples](https://github.com/civitai/civitai-app-starters/tree/main/starters/examples).

## License

MIT
