# Agent Guide — `@civitai/app-sdk`

> **If you only read one thing:** this package is the shared OAuth +
> orchestrator glue every starter under `starters/*` depends on. It is
> **runtime-agnostic** — Node 20+ APIs only, no framework imports. Changes
> here ship to npm and are consumed by external apps via `pnpm add
> @civitai/app-sdk`.

## Stack

TypeScript strict, ESM-only, zero runtime dependencies. Built with `tsc`
to `dist/`. Tested with `vitest`. Published to npm with subpath exports
(`./oauth`, `./scopes`, `./cookies`, `./orchestrator`).

## Where things live

| Path | Purpose |
|---|---|
| `src/oauth/` | PKCE, authorize URL builder, code exchange, refresh, revoke, `fetchMe`. The OAuth flow as stateless functions. |
| `src/scopes/` | `TokenScope` bitmask + `bitmaskFromScopes` / `scopesFromBitmask` / `hasScope` / `getScopeLabel`. Mirrors `civitai/civitai`'s `src/shared/constants/token-scope.constants.ts` — keep in sync. |
| `src/cookies/` | AES-256-CTR `sealCookie` / `unsealCookie` + `buildSetCookieHeader` / `readCookie`. Used by every starter to seal sessions into one `httpOnly` cookie. |
| `src/orchestrator/` | Orchestrator client factory, `estimateWorkflow` / `submitWorkflow` / `getWorkflow` / `pollWorkflow`, `buildTextToImageBody`, types + `OrchestratorError`. |
| `src/index.ts` | Re-exports the headline functions. Subpath exports stay the primary public surface. |
| `package.json` `exports` | Drives what's importable. Adding a new subpath means adding a new entry here. |

## Patterns to keep

- **Runtime-agnostic.** No `import 'next/...'`, no `from 'svelte'`, no
  `from '@sveltejs/kit'`, no `from 'react'`. The starters wrap these
  primitives in framework adapters; the SDK never knows what framework
  consumed it. **Web Crypto + `fetch` + Node `crypto` only.**
- **Zero runtime dependencies** in `package.json`. Type-only deps and
  devDeps are fine. Adding one is a deliberate decision — flag it in the
  changeset.
- **Pure functions over classes.** `createOrchestratorClient` is the only
  factory; everything else is a free function taking explicit arguments.
- **Throw `OAuthError` / `OrchestratorError`** so callers can pattern-match
  on the typed error class. Don't throw plain `Error` from the public
  surface.
- **Tokens live in arguments, never module state.** No `setAccessToken()`
  stashing — every function takes the token it needs. Makes the SDK safe
  to use in long-lived servers handling many users.

## Patterns to avoid

- ❌ Importing from any framework or any node-specific server package
  (`express`, `fastify`, `next/server`, `@sveltejs/kit`).
- ❌ Adding runtime dependencies without an explicit reason. Even small
  ones (e.g. `cookie`) get rewritten by hand here.
- ❌ Persisting state in module scope. Every function is stateless.
- ❌ Mutating arguments. Inputs are read-only; return new objects.
- ❌ `console.log` from library code. Throw or return; let callers log.

## Extending

| Task | How |
|---|---|
| New Civitai HTTP call | Add to the closest existing module (`oauth/` for auth-shaped, `orchestrator/` for orchestrator). Export from `src/index.ts` + add a subpath export to `package.json` if it's its own area. |
| New scope constant | `civitai/civitai` is the source of truth — copy the new flag into `src/scopes/index.ts` and update `tokenScopeLabels` / `TokenScopePresets` if relevant. |
| New cookie-shape helper | `src/cookies/index.ts`. Keep the AES-256-CTR + HMAC envelope; don't swap algorithms without a major bump. |
| Breaking API change | Author a **major** changeset; document the migration path in the changeset body. |
| Anything for one specific framework | **Wrong layer.** Put it in the starter, not the SDK. |

## Verifying changes

| You touched | Run |
|---|---|
| Anything in `src/` | `pnpm --filter @civitai/app-sdk typecheck` |
| Logic touched by unit tests | `pnpm --filter @civitai/app-sdk test` |
| Public API (added/changed export) | `pnpm --filter @civitai/app-sdk build` — verify `dist/` ships the new shape |
| Consumed by all four starters | `pnpm -r --filter "./starters/*" typecheck` from repo root |
| OAuth or session shape | `pnpm e2e:all` from repo root (needs civitai-dev server) |

After any meaningful change: `pnpm changeset` to author a patch/minor/major
entry. See [`RELEASING.md`](../../RELEASING.md) for the full publish flow.
