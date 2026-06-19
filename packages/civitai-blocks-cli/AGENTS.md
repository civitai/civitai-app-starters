# Agent Guide — `@civitai/blocks-cli` (DEPRECATED)

> **DEPRECATED — do not extend.** This npm scaffolder is retired in favor of the
> Go **`civitai` CLI** ([github.com/civitai/cli](https://github.com/civitai/cli)),
> which is a superset (`civitai app init/dev/validate/submit/login`). It's
> `"private": true` and `ignore`'d in `.changeset/config.json`, so it's never
> versioned or published again. The source below is kept only for history; new
> scaffolding/dev/submit work belongs in the Go CLI repo.

> **If you only read one thing:** this package is a thin CLI wrapper around
> two things — `npx tiged` for scaffolding and `npx vite` for dev. Manifest
> validation goes through `defineBlock` from `@civitai/app-sdk/blocks` so
> the CLI never reimplements rules the SDK already owns. The only real
> server-talking command is `deploy`, and that's a stub until per-app OAuth
> replaces `JOB_TOKEN` on the platform side.

## Stack

- TypeScript strict, ESM-only.
- `commander` for the command tree.
- `@civitai/app-sdk` as a runtime dep — pulled in for `defineBlock` and `BLOCK_SCOPES`.
- Tested with `vitest` (input-validation arms; the `tiged` shell-out is exercised manually).

## Where things live

| Path | Purpose |
|---|---|
| `src/index.ts` | Bin entry with `#!/usr/bin/env node`. Registers commands via commander; routes to per-command handlers. |
| `src/commands/init.ts` | Scaffolds a new block project from the starter. Validates `--block-id` / `--slot` / `--content-rating` BEFORE shelling out to tiged so bad input doesn't leave a half-clone on disk. Patches `block.manifest.json` + `civitai.app.json` post-clone; pipes the patched manifest through `defineBlock` so authoring mistakes fail at init time, not deploy time. |
| `src/commands/dev.ts` | Spawns `npx vite` with `VITE_DEV_HARNESS=true`. Exists so `civitai dev` "just works" after `civitai init`; users who know the flag can just `pnpm dev:harness`. |
| `src/commands/deploy.ts` | Runs the manifest preflight (validate every manifest listed in `civitai.app.json.blocks[]` via `defineBlock`), then prints a clear "coming soon" notice. The platform endpoint is `JOB_TOKEN`-gated today; per-app OAuth lands in Phase 2. |
| `src/commands/bundle.ts` / `upload.ts` / `publish.ts` | Pure "coming soon" stubs reserved for v2 inline mode (host-rendered asset bundles). v1 iframe blocks use `vite build` instead. |

## Patterns to keep

- **Validation before side effects.** Every command that touches the filesystem validates inputs first (init's blockId/slot/contentRating, deploy's manifest list). Never leave the user with a half-clone or half-patched manifest because we discovered the bad input too late.
- **Defer manifest rules to `defineBlock`.** Don't reimplement the blockId pattern, sandbox checks, or scope format here — they live in `@civitai/app-sdk/blocks` and the JSON schema. If the CLI accepts something the SDK rejects (or vice versa) the user gets a confusing error class.
- **Shell out for big lifts.** `tiged` already handles the GitHub fetch; `vite` already handles the dev server. Wrapping them via `npx` keeps the CLI tarball small and avoids reimplementing what's already on disk.
- **One real version: `0.0.0` until first publish.** Changesets bumps it. Don't hand-edit `package.json` versions.

## Patterns to avoid

- ❌ Adding a fetch library for `deploy`. The endpoint is JOB_TOKEN-gated and not callable from a user CLI today; printing the preflight + the "coming soon" line is correct. When OAuth lands, use the global `fetch` and the SDK's OAuth helpers — don't pull in `axios` or `node-fetch`.
- ❌ Reaching for `inquirer` / `prompts` for interactive flow. Flags-driven input keeps init scriptable (CI pipelines, automation). If interactivity becomes essential, lazy-import the prompt library so non-interactive callers don't pay for it.
- ❌ Bundling the starter template inside the CLI tarball. The starter lives at `starters/civitai-block-starter/` in this same repo and is fetched via tiged. Bundling would mean two copies in lockstep.
- ❌ Catching errors from shell-outs silently. `npx tiged` and `npx vite` inherit stdio; their errors land in front of the user. The CLI re-throws with a meaningful message.

## Extending

- **New scaffolding template** (e.g. a Svelte block starter) — add it under `starters/` first, then teach `init` about a `--template` flag and the new tiged target. Keep blockId/slot/contentRating validation shared across templates.
- **`deploy` going real** — once `POST /api/v1/developer/block-manifests` accepts per-app OAuth, the deploy command's "coming soon" branch becomes the actual POST. The preflight stays as-is. Auth helpers come from `@civitai/app-sdk` (the OAuth side, not the blocks subpath).
- **`bundle` / `upload` / `publish`** — land with v2 inline mode. Each one already has its own command + stub; flesh out when the platform substrate exists.

## Verifying changes

| You touched | Run |
|---|---|
| Any `src/` file | `pnpm --filter @civitai/blocks-cli typecheck && pnpm --filter @civitai/blocks-cli test` |
| Public bin shape | `pnpm --filter @civitai/blocks-cli build` and verify `dist/index.js` is `chmod +x`'d (tsc preserves the shebang; node honors it via the `bin` field). |
| Manifest validation paths | The shared rules live in `@civitai/app-sdk/blocks` — changes there require a matching JSON-schema + test update there, NOT here. |

After any meaningful change: `pnpm changeset` in the repo root.
