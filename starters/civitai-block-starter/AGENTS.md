# Agent Guide — `civitai-block-starter`

> **If you only read one thing:** this is a Vite + React SPA designed to be
> iframe-embedded by civitai.com inside a model-page slot. There is no BFF,
> no OAuth flow, no session cookies — the host injects everything (token,
> context, viewer, theme) via `BLOCK_INIT` postMessage. The demo: read
> `useBlockContext()`, render UI keyed on slot + viewer + theme, let
> `useBlockResize` drive iframe height.

You're inside the Civitai Apps starter for Civitai. The user cloned this to
bootstrap their own block — there is **no monorepo around you**;
`@civitai/app-sdk` and `@civitai/blocks-react` are npm dependencies, not
sibling workspaces. Help them extend it.

## Stack

- Vite 7 + React 19 + TypeScript strict
- `@civitai/blocks-react` for the eight hooks + the singleton `IframeTransport`
- `@civitai/app-sdk/blocks` for the manifest types, scope strings, JSON schema, and the `defineBlock` validator
- No styling library — the demo uses inline styles + the `[data-theme]` attribute the host provides

## Why this shape

Civitai Apps render *inside* civitai.com pages, not as standalone destinations.
That changes the trust model:

- The block has no session of its own — it has a short-lived JWT minted by
  civitai.com, scoped to a single block instance, with at most a `buzzBudget`
  for orchestrator spend.
- The block never sees `client_secret` or `access_token`. There's nothing
  to leak.
- All Civitai API calls flow with the block JWT, not OAuth bits.
- The iframe is sandboxed by civitai.com (server-side) — `allow-same-origin`
  is never granted, so `window.parent.document` is unreachable from the
  block.

Don't try to "make this a real OAuth app." That's what `react-pwa` is for.

## File layout

```
.
├── block.manifest.json     # registered with civitai.com — declares slot + scopes (NOT iframe.src; platform stamps it)
├── civitai.app.json        # CLI config (appId + manifest list)
├── index.html
├── vite.config.ts
├── .env.example
├── src/
│   ├── App.tsx             # the block UI
│   ├── main.tsx            # mounts <App/> (wraps in <Harness/> when VITE_DEV_HARNESS=true)
│   ├── index.css
│   └── dev/
│       └── Harness.tsx     # local BLOCK_INIT simulator
```

## Patterns to keep

- **Read state through the hooks, never reach into `window.parent`.** The hook layer abstracts iframe vs. inline transport — block apps that touch `window.parent` directly will break in inline mode (v2). Add a hook if a hook doesn't exist; don't bypass.
- **Gate UI on `ready`.** `useBlockContext().ready` is `false` until `BLOCK_INIT` lands. Render a small skeleton (or nothing) while waiting — the host shows its own loading state next to the iframe.
- **Attach `useBlockResize` to your root element.** The iframe doesn't auto-resize; `RESIZE_IFRAME` messages drive that. Without `useBlockResize` the iframe stays at `iframe.minHeight` from the manifest.
- **Narrow `context` per slot.** `BlockContext` is intentionally loose (`{ slotId, [key]: unknown }`). When you know your manifest targets model-page slots, cast to `ModelSlotContext` (from `@civitai/app-sdk/blocks`) to get `modelId`, `modelVersionId`, `modelName`, etc. typed. Other slot families get their own narrowing types as they ship.
- **Treat `viewer === null` as anonymous.** The platform sends `viewer: null` for signed-out users, not an object with everything nulled out.

## Patterns to avoid

- ❌ Storing tokens in `localStorage` / `sessionStorage` / `IndexedDB`. The transport caches the JWT and rotates it via `TOKEN_REFRESH` from the host every ~13 minutes; manual storage adds nothing and is one more thing to leak.
- ❌ Decoding the JWT in the block. `useBlockToken().scopes` / `.buzzBudget` / `.expiresAt` are already pulled from the wrapped token; the orchestrator does the actual JWT verification via JWKS.
- ❌ Calling `civitai.com` APIs that haven't been wired through the block-scoped path. The middleware on the server side only honors requests for scopes the block declared in its manifest — calls to other endpoints will fail.
- ❌ Importing `process.env.*` for runtime config. Vite uses `import.meta.env`; build-time vars must be prefixed `VITE_`.
- ❌ Removing the dev `Harness`. It's the only way to iterate UI without civitai.com embedding your block. If you don't need it, just don't run `pnpm dev:harness`.

## Extending

- **New slot** — change `targets[0].slotId` in `block.manifest.json`. The slot enum is server-controlled; the platform team adds new slots.
- **New scope** — add the scope string to `block.manifest.json`'s `scopes` array, then re-register (Phase 2 self-service via the CLI; for now coordinate with the server team). Scope changes reset `app_blocks.status` to `pending` and require re-approval.
- **Buzz-spending generation** — add `ai:write:budgeted` to manifest scopes and use `useBuzzWorkflow()`. The host caps each generation at the token's `buzzBudget`. For a **page app** that value comes from the manifest's `page.buzzBudgetPerGen`; for a **model-slot app** (like this starter) it comes from the install's `buzz_budget_per_gen` setting, not the manifest. Show `useBuzzWorkflow().status` next to your "Generate" button so users see polling state.
  - 🔴 **The per-gen budget is a SAFETY CEILING, not a cost estimate — never size it to what you think a run costs.** It caps what ONE generation may cost so a buggy or compromised app can't drain the viewer's Buzz. Set it to *several times* your worst-case run (e.g. `1000` when you expect ~100). Headroom is free: the server re-prices every submit and charges the real price, clamps the budget at the per-gen cap (1000) anyway, and separately caps cumulative spend per viewer per day. Size it to an estimate and the app **breaks**: a submit priced above the budget is rejected outright with `insufficient buzz budget` — nothing charged, nothing delivered — and for a page app it stays broken for every user until a new manifest version ships and is re-approved. Any upward drift (more steps, bigger resolution, pricier model or recipe) does that.
- **Per-viewer settings** — Phase 2 (`block_user_settings` table). Don't roll your own persistence — flag the gap and wait for the platform.
- **Multiple manifests** (one repo, several blocks) — add entries to `civitai.app.json`'s `blocks` array. Each manifest is independently versioned and reviewed.

## Demo flow

1. `pnpm dev:harness` — Vite starts; harness mounts.
2. Harness mocks `window.parent.postMessage` and posts a fake `BLOCK_INIT`.
3. `useBlockContext()` flips `ready: true`; `App` renders with mock model context + viewer.
4. `useBlockResize` posts a `RESIZE_IFRAME` to the harness's mock parent on every height change (visible in the bottom console panel).
5. Token auto-refresh fires at the 2-min-before-expiry mark; the harness echoes `TOKEN_REFRESH_RESPONSE` with a new mock JWT.

## Verifying changes

| You touched | Run |
|---|---|
| `src/App.tsx`, any block UI | `pnpm typecheck && pnpm dev:harness` and verify visually |
| `vite.config.ts`, env wiring | `pnpm build` |
| `block.manifest.json` | Validate against the JSON schema: `node -e "import('./node_modules/@civitai/app-sdk/dist/blocks/defineBlock.js').then(m => m.defineBlock({manifest: require('./block.manifest.json')}))"` |

The starter intentionally ships without an e2e suite — real end-to-end
verification requires civitai.com embedding the block. The dev harness +
unit-level coverage in `@civitai/blocks-react` are the test surface.
