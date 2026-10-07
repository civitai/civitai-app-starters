# Agent Guide — `civitai-block-starter`

> **If you only read one thing:** this is a Vite + React SPA designed to be
> iframe-embedded by civitai.com inside a model-page slot. There is no BFF,
> no OAuth flow, no session cookies — the host injects everything (token,
> context, viewer, theme) via `BLOCK_INIT` postMessage. The demo: read
> `useBlockContext()`, render UI keyed on slot + viewer + theme, let
> `useBlockResize` drive iframe height.

You're inside the **React** Civitai Apps starter for Civitai (the default, framework-free one is `starters/civitai-block-starter-elements`; don't port this one to it unless asked). The user cloned this to
bootstrap their own block — there is **no monorepo around you**;
`@civitai/app-sdk` and `@civitai/blocks-react` are npm dependencies, not
sibling workspaces. Help them extend it.

## Stack

- Vite 7 + React 19 + TypeScript strict
- `@civitai/blocks-react` for the block hooks + the singleton `IframeTransport`.
  🔴 **Do not trust a hook count — enumerate.** The hook set grows every release;
  this line said "the eight hooks" until 2026-09-29, by which point the package
  exported 37 and the two newest (`useGoodPurchase` / `useEntitlements`) had been
  invisible to every agent that read it. Enumerate from the package you actually
  installed — `node -e "import('@civitai/blocks-react').then(m => console.log(Object.keys(m).filter(k => k.startsWith('use')).sort().join(' ')))"`.
- `@civitai/app-sdk/blocks` for the manifest types, scope strings and the JSON schema
- `@civitai/app-sdk/vite` for `blockManifestPlugin`, the build-time manifest gate (needs the optional peer `ajv`, already in `devDependencies`)
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
├── civitai.app.json        # CLI config (appId + manifest list) — appId lives HERE, not in the manifest
├── index.html
├── vite.config.ts          # registers blockManifestPlugin — validates block.manifest.json on every dev boot + build
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
- **Gate sign-in with `isSignedIn(viewer)`** (from `@civitai/app-sdk/blocks`), and do not open-code the gate. The platform sends `viewer: null` for signed-out users — never an object with everything nulled out. Which spelling is correct has already changed once, so the SDK owns it in one function: `signedIn` is optional on the wire and is the one viewer field the init validator deliberately does not reject when malformed, so `isSignedIn` answers from presence. It reads neither `viewer.id` nor `viewer.username` (both `@deprecated` and scheduled for removal), so nothing you write through it changes when those go. Need the identity itself? Call `useViewer()` — scope-gated and audited per call.

## Boot skeleton

`block.manifest.json` declares `"bootSkeleton": true` and `index.html` paints a
matching skeleton inside `#root`. **They are ONE change — never keep one and drop
the other.** The key tells the App Blocks full-page run host to stand down its
own loading UI (no branded veil, iframe at `opacity: 1` from mount, no reveal
transition; it publishes `aria-busy` on the iframe instead). Over an empty
`#root` that is strictly *worse* than not opting in: the viewer stares at a blank
iframe for the whole load, precisely because the covering veil was removed at the
app's request. Deleting the skeleton markup while tidying `index.html` looks like
removing dead scaffolding, which is why
`tests/guards/boot-skeleton.test.mjs` in this monorepo blocks it.

Two things worth knowing before you edit either half:

- **The theme is not a guess — it is the HOST's.** Civitai apps default to
  dark and never consult the OS/browser preference. Light engages only when
  the viewer chose light on civitai.com, delivered by the host three ways:
  the `#civitai-block=v1&theme=…` URL fragment (read by an inline script in
  `index.html` **before first paint** — both host surfaces append it),
  `BLOCK_INIT` (authoritative, corrects a stale fragment), and
  `THEME_CHANGE` (the live push when the viewer toggles mid-session — synced
  onto `<html>` by the effect in `src/App.tsx`, since the host does not
  rewrite the iframe URL on a toggle). The base (unconditioned) CSS rules in
  `index.html` carry the dark values, light is applied *only* behind
  `html[data-theme='light']`, and there is deliberately **no** OS-preference
  media query anywhere in the document — `tests/guards/boot-skeleton.test.mjs`
  in this monorepo blocks one from coming back. `<meta name="color-scheme">`
  and `src/index.css`'s `color-scheme` both list `dark` first for the UA
  canvas (a CSS `color-scheme` declaration overrides the meta tag, and Vite
  emits `index.css` as a render-blocking `<link>` in the built document).
  🔴 `src/index.css` must NOT set a `background` on `html`/`body`: it is
  emitted after the inline style, so it would win the cascade and hand the
  page back to the OS canvas colour.
- **Nothing removes the skeleton, and that is React-specific.**
  `createRoot(container).render(...)` clears the container's children before its
  first commit — measured, see
  `packages/civitai-blocks-react/test/bootSkeletonRemoval.test.tsx`. Svelte 5's
  `mount(App, { target })` **appends** and needs an explicit
  `document.querySelector('[data-boot-skeleton]')?.remove()`. Assume append for
  anything unmeasured. And keep the skeleton a *descendant* of `#root`: React
  only clears what it mounts into, so a sibling stays on screen forever.

`bootSkeleton` is honoured by the **full-page run host only** — this starter
targets `model.sidebar_top` and has no `page` surface, so the key changes nothing
today. It ships as the scaffolded default, correct the moment the app gains a
page surface, with the markup already in place so the two can never separate.

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
- **Selling something (digital goods)** — needs `@civitai/app-sdk` ≥ 0.52.0 and
  `@civitai/blocks-react` ≥ 0.59.0; this starter already pins both, so a fresh
  scaffold has the whole path. Declare a `goods` array in `block.manifest.json`,
  add `goods:purchase:self` (to sell) and `goods:read:self` (to read entitlements
  back) to `scopes`, then call `useGoodPurchase()` to buy and `useEntitlements()`
  to check ownership (`owns(goodId)`). Each good is `{ id, title, priceBuzz }`
  plus an optional `description`; `priceBuzz` is **whole Buzz, 2–50000** (the
  floor is 2 because the owner's 70% share is floored, so a 1-Buzz item would
  earn its owner nothing, permanently), at most 32 goods per manifest. Points
  worth knowing before you design around it:
  - 🔴 **`id` is what an entitlement is keyed by.** Renaming it in a later
    version orphans every entitlement already granted under the old id.
  - 🔴 **The catalog is REVIEW-GATED.** The catalog a moderator approves is the
    catalog that can be sold, and changing a price means shipping a new manifest
    version and being re-reviewed — the same gate as a scope change.
  - **The platform owns the ledger, you own the meaning.** It records who bought
    what, when, at what price, and its refund state; what the good *does* is your
    app's business — keep those semantics in your own app storage.
  - **Pass `expectedPriceBuzz`** — the server charges its own price and refuses
    when yours disagrees, which turns "the app showed a stale price" into a clean
    refusal instead of a viewer charged an amount they never saw.
  - **A purchase can be refused at a perfectly legal price.** The viewer has a
    daily ceiling across every app they have installed, so handle the 4xx; do not
    treat a valid `priceBuzz` as a guarantee of success.
  - Sales split platform 30% / app owner 70%, paid immediately.
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
| `block.manifest.json` | Nothing extra — `blockManifestPlugin` (from `@civitai/app-sdk/vite`, registered in `vite.config.ts`) validates it against the canonical schema on every `pnpm dev`, `pnpm dev:harness` and `pnpm build`, and fails with the offending field path. `pnpm build` is the quickest way to check in isolation. Before submitting, also run `civitai app validate` — the CLI checks things only the server knows. |

The starter intentionally ships without an e2e suite — real end-to-end
verification requires civitai.com embedding the block. The dev harness +
unit-level coverage in `@civitai/blocks-react` are the test surface.
