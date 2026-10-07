# Agent Guide — `civitai-block-starter`

> **If you only read one thing:** this is a Vite + TypeScript SPA with **no UI
> framework**, iframe-embedded by civitai.com in a model-page slot. The host
> injects everything (token, context, viewer, theme) via `BLOCK_INIT`;
> `initialize()` from `@civitai/sdk` waits for it and returns `app`. The UI is
> `<civitai-*>` custom elements from `@civitai/components`. The demo
> (`src/block.ts`): `await initialize()`, render slot + viewer + theme into
> elements, re-render on `app.onChange`, let `app.host.autoResize` drive the
> iframe height.

You're inside the Civitai App starter. The user copied this to bootstrap their
own block — there is **no monorepo around you**; the `@civitai/*` packages are
npm dependencies. Help them extend it.

If they want **React** instead, don't add it here. Point them at the Go
[`civitai` CLI](https://github.com/civitai/cli)'s React template
(`civitai app create <name>` — its default template, `page-money`, is
Vite + React + TS) or at the six React examples under
`starters/examples/*` in the civitai-app-starters repo, which use the
`@civitai/blocks-react` hooks.

## Stack

- Vite + TypeScript strict, no framework, no JSX
- `@civitai/sdk` — the host bridge (`initialize`, `app.host`, `app.onChange`)
  plus the API clients (`app.site`, `app.storage`, `app.sharedStorage`,
  `app.orchestration`). Its README is the reference; read `app.host`'s methods
  from the installed types rather than from a list here.
- `@civitai/components` — the `<civitai-*>` elements, all registered by
  `import '@civitai/components/register'` in `src/block.ts`. The full contract
  (every tag, attribute, event, `::part` and slot) is
  `node_modules/@civitai/components/custom-elements.json`.
- `@civitai/theme` — the `--civitai-*` tokens (`src/main.ts` imports its CSS).
- `@civitai/app-sdk` — `@civitai/app-sdk/blocks` for the slot/viewer predicates,
  scope names and manifest types; `@civitai/app-sdk/vite` for
  `blockManifestPlugin`, the build-time manifest gate (needs the optional peer
  `ajv`, already a devDependency).

## Why this shape

Civitai Apps render *inside* civitai.com pages, not as standalone destinations.
That changes the trust model:

- The block has no session of its own — it has a short-lived token minted by
  civitai.com, scoped to a single block instance, with at most a `buzzBudget`
  for spend.
- The block never sees a `client_secret`. There's nothing to leak.
- The iframe is sandboxed by civitai.com — `allow-same-origin` is not granted to
  third-party blocks, so `window.parent.document` is unreachable and reading
  `localStorage` throws (hence `@civitai/sdk/safe-storage`).

Don't try to "make this a real OAuth app." That is what the `next-app` /
`react-pwa` starters are for.

## File layout

```
.
├── block.manifest.json     # registered with civitai.com — slot + scopes (NOT iframe.src; the platform stamps it)
├── index.html              # boot skeleton + pre-paint theme script
├── vite.config.ts          # blockManifestPlugin — validates block.manifest.json on every dev boot + build
├── src/
│   ├── main.ts             # entry: safe-storage FIRST, theme CSS, dev harness, mountBlock
│   ├── block.ts            # the block: initialize → render → onChange → autoResize
│   ├── directLoad.ts       # "Open on Civitai" card for a top-level (unembedded) load
│   ├── index.css
│   └── dev/harness.ts      # local BLOCK_INIT simulator (`npm run dev:harness`)
└── test/block.test.ts      # drives the block through the real bridge (happy-dom)
```

## Patterns to keep

- **Go through `@civitai/sdk`, never `window.parent`.** The bridge validates the
  parent origin, correlates replies and folds host pushes into one snapshot.
  Hand-rolled `postMessage` code skips all three.
- **Render after `initialize()` resolves.** Until then the boot skeleton is the
  loading state. Read `app.context` / `app.theme` / `app.viewer` on every
  render — they are live — and re-render from `app.onChange`.
- **Sync `<html data-theme>` from `app.theme`** (`syncTheme` in `src/block.ts`),
  and only after `initialize()` resolves — before that, the bridge's theme is a
  placeholder. The elements read `--civitai-*` tokens that `[data-theme]`
  selects, so this one attribute re-themes the page and every element together.
- **Call `app.host.autoResize(root)`.** Without it the iframe stays at the
  manifest's `iframe.minHeight`.
- **Narrow `context` with `isModelSlotContext` / `isPageSlotContext`** from
  `@civitai/app-sdk/blocks` before reading slot fields.
- **Gate sign-in with `isSignedIn(app.viewer)`** from `@civitai/app-sdk/blocks`,
  never an open-coded check. The platform sends `viewer: null` for signed-out
  users. For the viewer's identity, read the API (`app.site.get('me')`), not
  `app.viewer`.
- **Host data goes in with `textContent`, never `innerHTML`.** The view in
  `src/block.ts` is a static template filled field by field; a model name is
  user-authored, and interpolating it into markup is an XSS hole.
  `test/block.test.ts` pins this.
- **Register every element you use.** `@civitai/components/register` covers all
  of them. If you trim it to per-element `…/<tag>/define` imports, an element
  you forget renders as an inert, unstyled tag with no error.
- **Keep `import '@civitai/sdk/safe-storage'` the first import in `src/main.ts`.**

## Boot skeleton

`block.manifest.json` declares `"bootSkeleton": true` and `index.html` paints a
matching skeleton inside `#root`. **They are ONE change — never keep one and
drop the other.** The key tells the full-page run host to stand down its own
loading UI; over an empty `#root` the viewer stares at a blank iframe for the
whole load. `tests/guards/boot-skeleton.test.mjs` in the monorepo blocks that.

- **Nothing removes the skeleton but the first render** — `root.replaceChildren`
  in `src/block.ts`. There is no framework clearing the container, so the
  skeleton must stay a *descendant* of `#root`.
- **The theme is the HOST's.** Dark by default; light only behind
  `html[data-theme='light']`, set from the host fragment before paint, then
  `BLOCK_INIT`, then `THEME_CHANGE`. No OS-preference media query anywhere, and
  🔴 `src/index.css` must not set a `background` on `html`/`body` — it would win
  the cascade over the boot style.

`bootSkeleton` is honoured by the **full-page run host only** — this starter
targets `model.sidebar_top`, so the key changes nothing until the app gains a
page surface. It ships as the default so the markup and the declaration never
separate.

## Patterns to avoid

- ❌ Storing tokens anywhere. The SDK holds the token and refreshes it; use
  `app.getToken()` for a call the SDK does not make itself.
- ❌ Decoding the token in the block. Scopes and budget come with it; the
  server does the verification.
- ❌ `process.env.*` for runtime config. Vite uses `import.meta.env`, `VITE_`-prefixed.
- ❌ Removing the dev harness. It is the only way to iterate without
  civitai.com embedding your block, and it is dropped from production builds.

## Extending

- **New slot** — change `targets[0].slotId` in `block.manifest.json`; narrow
  `context` for it. The slot enum is server-controlled.
- **New scope** — add it to `block.manifest.json`'s `scopes`. The build gate
  refuses an unknown scope; a scope change resets approval and needs re-review.
- **More UI** — add elements to the template in `src/block.ts` and fill them in
  `render`. Listen for element events (`change`, `click`, …) with
  `addEventListener`; keep state in a module variable and call `render` again.
- **Host UI** (resource picker, Buzz purchase, image upload, navigation,
  sign-in) — `app.host.*`; each rejects with a `BridgeError` carrying a `code`.
- **Per-viewer storage** — `app.storage` (`get` / `set` / `list` /
  `getQuota`); refused for an anonymous viewer, so gate on
  `isSignedIn(app.viewer)`. Cross-viewer data: `app.sharedStorage`.
- **Buzz-spending generation** — add `ai:write:budgeted` to `scopes` and submit
  through the block route, `app.site.post('blocks/workflows/submit', …)`.
  🔴 Do **not** call `app.orchestration` from a block: a direct orchestrator call
  skips the per-call budget, the daily caps and attribution (the `@civitai/sdk`
  README explains). The host caps each generation at the token's `buzzBudget`
  — for a model-slot app like this one that comes from the install's
  per-generation setting; for a page app, from `page.buzzBudgetPerGen`.
  - 🔴 **The per-gen budget is a SAFETY CEILING, not a cost estimate.** Set it to
    several times your worst-case run. A submit priced above it is rejected
    outright (`insufficient buzz budget`), nothing charged and nothing
    delivered, and for a page app it stays broken until a new manifest version
    is approved.
  - The `buzz-workflow` example in the civitai-app-starters repo is a complete
    estimate → submit → poll flow (React, but the routes are the same).
- **Selling something (digital goods)** — declare a `goods` array in
  `block.manifest.json`, add `goods:purchase:self` (to sell) and
  `goods:read:self` (to read entitlements back) to `scopes`. Each good is
  `{ id, title, priceBuzz }` plus an optional `description`; `priceBuzz` is
  whole Buzz, 2–50000, at most 32 goods per manifest. There is no typed helper
  in `@civitai/sdk` yet, so call the block routes through `app.site`:
  `app.site.post('blocks/goods/purchase', { goodId, expectedPriceBuzz, idempotencyKey })`
  and `app.site.get('blocks/entitlements')`.
  - 🔴 **`id` is what an entitlement is keyed by.** Renaming it orphans every
    entitlement already granted under the old id.
  - 🔴 **The catalog is REVIEW-GATED** — a price change is a new manifest version
    and a new review, like a scope change.
  - **Pass `expectedPriceBuzz`**: the server charges its own price and refuses
    when yours disagrees, so a stale price becomes a clean refusal.
  - **Reuse one `idempotencyKey` across retries of the same purchase** (validate
    it with `isValidBlockIdempotencyKey` from `@civitai/app-sdk/blocks`): a
    timed-out request may or may not have charged, and only a retry with the
    SAME key can find out safely.
  - A purchase can be refused at a perfectly legal price (the viewer has a
    daily ceiling across apps) — handle the 4xx.

## Verifying changes

| You touched | Run |
|---|---|
| `src/**` | `npm run typecheck && npm test`, then `npm run dev:harness` and look |
| `vite.config.ts`, env wiring | `npm run build` |
| `block.manifest.json` | `npm run build` (the manifest is validated on every dev boot and build); before submitting, `civitai app validate` |
