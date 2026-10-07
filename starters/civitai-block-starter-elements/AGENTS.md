# Agent Guide — `civitai-block-starter-elements`

> **If you only read one thing:** this is a Vite + TypeScript SPA with **no UI
> framework**, iframe-embedded by civitai.com in a model-page slot. The host
> injects everything (token, context, viewer, theme) via `BLOCK_INIT`;
> `initialize()` from `@civitai/sdk` waits for it and returns `app`. The UI is
> `<civitai-*>` custom elements from `@civitai/components`. The demo
> (`src/block.ts`): `await initialize()`, render slot + viewer + theme into
> elements, re-render on `app.onChange`, let `app.host.autoResize` drive the
> iframe height.

You're inside the recommended Civitai App starter. The user copied this to
bootstrap their own block — there is **no monorepo around you**; the
`@civitai/*` packages are npm dependencies. Help them extend it. If they want
React instead, point them at `starters/civitai-block-starter` (same manifest,
same demo, `@civitai/blocks-react` hooks) rather than adding React here.

## Stack

- Vite + TypeScript strict, no framework, no JSX
- `@civitai/sdk` — the host bridge (`initialize`, `app.host`, `app.onChange`)
  plus the API clients (`app.site`, `app.storage`, `app.sharedStorage`,
  `app.orchestration`). Its README is the reference; enumerate `app.host`'s
  methods from the installed types rather than trusting a list here.
- `@civitai/components` — the `<civitai-*>` elements, all registered by
  `import '@civitai/components/register'` in `src/block.ts`. The full contract
  (every tag, attribute, event, `::part` and slot) is
  `node_modules/@civitai/components/custom-elements.json`.
- `@civitai/theme` — the `--civitai-*` tokens (`src/main.ts` imports its CSS).
- `@civitai/app-sdk` — `@civitai/app-sdk/blocks` for the slot/viewer predicates
  and manifest types; `@civitai/app-sdk/vite` for `blockManifestPlugin`, the
  build-time manifest gate (needs the optional peer `ajv`, already a devDependency).

## File layout

```
.
├── block.manifest.json     # registered with civitai.com — slot + scopes (NOT iframe.src; the platform stamps it)
├── civitai.app.json        # CLI config (appId + manifest list)
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
- **Sync `<html data-theme>` from `app.theme`** (`syncTheme` in `src/block.ts`).
  The elements read `--civitai-*` tokens that `[data-theme]` selects, so this one
  attribute re-themes the page and every element together.
- **Call `app.host.autoResize(root)`.** Without it the iframe stays at the
  manifest's `iframe.minHeight`.
- **Narrow `context` with `isModelSlotContext` / `isPageSlotContext`** from
  `@civitai/app-sdk/blocks` before reading slot fields.
- **Gate sign-in with `isSignedIn(app.viewer)`**, never an open-coded check.
  The platform sends `viewer: null` for signed-out users. For the viewer's
  identity, read the API (`app.site.get('me')`), not `app.viewer`.
- **Host data goes in with `textContent`, never `innerHTML`.** The view in
  `src/block.ts` is a static template filled field by field; a model name is
  user-authored, and interpolating it into markup is an XSS hole.
  `test/block.test.ts` pins this.
- **Register every element you use.** `@civitai/components/register` covers all
  of them. If you trim it to per-element `…/<tag>/define` imports, an element
  you forget renders as an inert, unstyled tag with no error.
- **Keep `import '@civitai/sdk/safe-storage'` the first import in `src/main.ts`.**
  The block runs at an opaque origin where reading `localStorage` throws.

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
  `BLOCK_INIT`, then `THEME_CHANGE`. No `prefers-color-scheme` anywhere, and
  🔴 `src/index.css` must not set a `background` on `html`/`body` — it would win
  the cascade over the boot style.

## Patterns to avoid

- ❌ Storing tokens anywhere. The SDK holds the token and refreshes it; use
  `app.getToken()` for a call the SDK does not make itself.
- ❌ Calling `app.orchestration` to generate from a block — submit through
  `POST /api/v1/blocks/workflows/submit` (see the `@civitai/sdk` README).
- ❌ `process.env.*` for runtime config. Vite uses `import.meta.env`, `VITE_`-prefixed.
- ❌ Removing the dev harness. It is the only way to iterate without
  civitai.com embedding your block, and it is dropped from production builds.

## Extending

- **New slot** — change `targets[0].slotId` in `block.manifest.json`; narrow
  `context` for it. The slot enum is server-controlled.
- **New scope** — add it to `block.manifest.json`'s `scopes`. Scope changes
  require re-approval.
- **More UI** — add elements to the template in `src/block.ts` and fill them in
  `render`. Listen for element events (`change`, `click`, …) with
  `addEventListener`; for anything stateful, keep state in a module variable and
  call `render` again. Reach for a framework only when that stops scaling — at
  that point the React starter is the supported path.
- **Host UI** (resource picker, Buzz purchase, image upload, navigation,
  sign-in) — `app.host.*`; each rejects with a `BridgeError` carrying a `code`.

## Verifying changes

| You touched | Run |
|---|---|
| `src/**` | `npm run typecheck && npm test`, then `npm run dev:harness` and look |
| `vite.config.ts`, env wiring | `npm run build` |
| `block.manifest.json` | `npm run build` (the manifest is validated on every dev boot and build); before submitting, `civitai app validate` |
