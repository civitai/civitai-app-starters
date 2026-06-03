# @civitai/blocks-cli

## 0.1.2

### Patch Changes

- 13ba162: Refresh the published READMEs for the App Blocks packages (these ship in the
  tarballs via `files`). `@civitai/app-sdk` gains an "App Blocks contract"
  section (message/transport protocol, `BLOCK_INIT` shape, `defineBlock`
  validator rules, version compatibility). `@civitai/blocks-react` documents
  every hook with a minimal snippet, the `/ui` `SettingsForm` subexport, the
  `useBuzzWorkflow` status semantics, and the self-set `data-theme` requirement;
  it also fixes the quick-start `submit()` snippet (full `WorkflowBody`, not
  `{ prompt }`) and lists all ten hooks (was eight). `@civitai/blocks-cli`
  clarifies that `deploy` is preflight-only and maps the commands to the
  `/apps/submit` review flow. No code changes.
- Updated dependencies [13ba162]
- Updated dependencies [e6e3858]
  - @civitai/app-sdk@0.8.0

## 0.1.1

### Patch Changes

- Republish to fix `workspace:^` protocol leaking into `dependencies."@civitai/app-sdk"` of the 0.1.0 tarball — npm consumers got `EUNSUPPORTEDPROTOCOL` on install. Replaced with explicit `^0.6.0` semver.

## 0.1.0

### Minor Changes

- Initial public release of `@civitai/blocks-cli` (0.1.0 — pre-1.0 v0): the `civitai` bin for scaffolding and shipping Civitai App Blocks.

  **Commands**

  - `civitai init [destination]` — scaffolds a new block project from the [`civitai-block-starter`](https://github.com/civitai/civitai-app-starters/tree/main/starters/civitai-block-starter) via `npx tiged`, then patches `block.manifest.json` + `civitai.app.json` with the supplied `--block-id` / `--app-id` / `--slot` / `--content-rating`. Validation runs through `defineBlock` before any disk write, so bad inputs fail fast without leaving a half-scaffolded directory.
  - `civitai dev` — convenience for `pnpm dev:harness`. Spawns `npx vite` with `VITE_DEV_HARNESS=true` set so the local harness mounts.
  - `civitai deploy` — validates every manifest in `civitai.app.json.blocks[]` via `defineBlock` (useful preflight), then prints a clear "coming soon" notice. The platform endpoint `POST /api/v1/developer/block-manifests` is currently `JOB_TOKEN`-gated; per-app OAuth replacing `JOB_TOKEN` is a Phase 2 follow-up and will turn this into a real publish path.
  - `civitai bundle` / `civitai upload` / `civitai publish` — stubs reserved for v2 inline mode (host-rendered asset bundles). All print "coming soon"; v1 iframe blocks use `vite build`.

  Depends on `@civitai/app-sdk ^0.6` (for `defineBlock` + `BLOCK_SCOPES`) and `commander ^12`.
