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

### `civitai deploy`

Validates every manifest listed in `civitai.app.json.blocks[]` (preflight, useful even without a server round-trip), then prints a "coming soon" notice.

The platform endpoint `POST /api/v1/developer/block-manifests` is currently `JOB_TOKEN`-gated — only civitai/civitai server jobs can call it. Hand the validated manifest(s) to the platform team along with your `appId` for registration. The CLI will publish directly once per-app OAuth replaces `JOB_TOKEN` (Phase 2 follow-up).

### `civitai bundle` / `civitai upload` / `civitai publish`

Reserved for v2 inline mode (host-rendered blocks loaded as static asset bundles rather than embedded iframes). All print "coming soon" today.

## License

MIT
