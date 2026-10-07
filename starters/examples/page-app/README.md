# page-app — a full-page Civitai App

The shape most third-party apps ship: a **page app**. The app is a whole page
at `/apps/run/<blockId>` instead of a panel inside another page. This example
is a small "favourites board": a viewer pins the Civitai models they keep coming
back to, adds a note, and opens them on Civitai later.

## What it shows

| Concept | Where |
|---|---|
| Manifest `page` (no `targets`), `tagline`, `category`, `contentRating`, `bootSkeleton` | `block.manifest.json` |
| Why there is no `page.buzzBudgetPerGen` | [below](#no-buzzbudgetpergen) |
| Page-shaped boot skeleton that fills the frame, dark first | `index.html` |
| `<BlockGate>` (built on `useDirectLoad`) for a direct, unembedded load | `src/main.tsx` |
| `useBlockBreakpoint()`: gutter, sidebar vs single column, detail layout | `App`, `PinDetail` in `src/App.tsx` |
| Full width from 375px to 2560px; no `useBlockResize` | `App`, `BoardGrid` |
| `useCivitaiRoute()` + `useCivitaiNavigate()` (app scope) for `''` and `pin/<id>` | `App`, `src/board.ts` (`parseRoute`) |
| `useCivitaiNavigate()` with `scope: 'site'`, current tab and new tab | `PinDetail` |
| `useHostOrigin()`: a link back to a pin | `PinDetail` |
| `useRequestSignIn()` for an anonymous viewer | `AccountPanel` |
| `useRequestConsent()` → `useBlockToken().scopes` → `useViewer()` | `AccountPanel`, `ViewerName` |
| `useConsentUnavailable()`: stop asking when the host says "never" | `AccountPanel` |
| `useBlockAnalytics()` | `App`, `AccountPanel`, `PinDetail` |
| `useAppStorage()`: the whole board in one per-viewer row | `App`, `src/board.ts` |

## What a page app changes

Citations are to `civitai/civitai` at `494941446d`.

- **It is declared by `page`, not by `targets`.** The host treats a manifest as
  a page app when `page.path` is a non-empty string
  (`src/server/services/block-registry.service.ts:600-605`). The URL is not
  taken from `path`. It is always `/apps/run/<blockId>/<subPath>`.
  `page.title` is the title shown in the host chrome.
- **The frame is the page, not the content.** The page host does not handle
  `RESIZE_IFRAME` ("page iframe is full-viewport (height:100%); no
  size-to-content", `src/components/AppBlocks/hostHandlerParity.ts:146-154`),
  so this app does not call `useBlockResize`. Its root uses `min-height: 100vh`
  instead. The manifest still carries `iframe.minHeight` / `maxHeight` /
  `resizable` only because the validators require them
  (`src/server/services/block-manifest-validator.service.ts:735-762`, and the
  CLI). The run page builds its own iframe envelope
  (`src/pages/apps/run/[slug]/[[...path]].tsx:556`).
- **The frame can be very wide.** The host no longer caps the page width; the
  old 1600px default was removed (`src/components/AppBlocks/PageBlockHost.tsx:415-452`).
  The developer guide's responsive page still mentions the 1600px cap. So the
  board grid uses `repeat(auto-fill, minmax(min(100%, 240px), 1fr))`, which
  gives one column at 375px and about nine at 2560px. `useBlockBreakpoint()`
  is a container query on the frame. It decides the structure: at `md`
  (1024px) and wider, the board sits beside a sticky 340px panel; below that,
  everything is one column with the pins before the form.
- **It owns a sub-path space.** `navigate('pin/42')` (app scope, the default)
  is resolved under `/apps/run/<slug>/` and pushed shallowly
  (`src/components/AppBlocks/pageBlockHostLogic.ts:1045`). The host then pushes
  `ROUTE_CHANGED`, and `useCivitaiRoute()` reads it
  (`PageBlockHost.tsx:2078`). `useCivitaiRoute()` is read on every render
  and never copied into state. `navigate('models/42', { scope: 'site' })`
  leaves the app for the civitai.com model page. The `page-run` surface allows
  that (`src/components/AppBlocks/blockInitFragmentGate.ts:215`).

## Sign-in, consent and the viewer's name

`user:read:self` is **consent-gated**. For a signed-in viewer who has not
granted it, the mint leaves it out of the token
(`src/pages/api/v1/block-tokens/index.ts:1494`). For an anonymous viewer it
is always removed (`:1523`). The host's viewer read refuses a token without it
(`src/server/routers/blocks.router.ts:7859`, "block lacks user:read:self
scope"). So `AccountPanel`:

1. **Anonymous** → **Sign in** calls `requestSignIn()`, and the host opens
   civitai.com's login. Storage `get` answers null for an anonymous viewer, so
   there is no board to load and no form.
2. **Signed in, scope missing** → **Show my name** calls
   `requestConsent({ scopes: ['user:read:self'] })`. The scope must be named:
   without it the host cannot prove a refusal and stays silent. On grant the
   host re-mints and pushes `TOKEN_REFRESH`.
3. **Scope present** (`useBlockToken().scopes`) → `ViewerName` mounts, and
   only then does `useViewer()` send `GET_VIEWER`.
4. **Refused** → `useConsentUnavailable()` delivers the host's
   `CONSENT_UNAVAILABLE`. The panel then stops saying "confirm in the dialog".
   The page host grants only the scopes the mint found missing **from the
   approved manifest** (`PageBlockHost.tsx:1867`), so a scope you did not
   declare can never be granted here.

The board works whether or not the viewer shares their name.

## No `buzzBudgetPerGen`

`page.buzzBudgetPerGen` is the per-generation Buzz ceiling signed into an
`ai:write:budgeted` token. This app runs no generations and does not declare
`ai:write:budgeted`, so a budget would have nothing to bound. Add both together
if your page generates; `buzz-workflow` shows the generation side.

## Not usable by third-party apps today

- **Page apps are behind a moderator-only flag.** `/apps/run/<slug>` needs both
  `appBlocks` and `appBlocksPages`. Otherwise it returns a 404
  (`src/pages/apps/run/[slug]/[[...path]].tsx:34-37,131`). `appBlocksPages`
  is `availability: ['mod']` until a Flipt segment widens it
  (`src/server/services/feature-flags.service.ts:616`). The live segment is
  runtime config and cannot be read from source.
- **`useBlockAnalytics()` is dropped.** Neither real host handles
  `TRACK_EVENT` ("no host-side sink wired", `hostHandlerParity.ts:168-177`).
  The calls here are harmless and show up in the harness log, but no event
  reaches any pipeline today. The hooks reference describes a pipeline that is
  not wired yet.
- **The pre-paint theme fragment is allowlisted.** The host appends
  `#civitai-block=v1&theme=…` only for apps in `BLOCK_INIT_FRAGMENT_ALLOWLIST`,
  which today holds one first-party app
  (`blockInitFragmentGate.ts:243-260`). For your app the `index.html` reader is
  a no-op on civitai.com. The dark default paints first, and a light host
  switches the page at `BLOCK_INIT`.

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5186
```

The mock host's default context is a complete page slot (slug `mock-app`), and
`src/Harness.tsx` seeds a three-pin board. Try `?viewer=anon` (sign-in),
`?consent=ungrantable` (the refusal), `?theme=light`. The corner log lists
every message the app sends.

**Where the stock mock differs from production, and what `src/Harness.tsx` does about it:**

| | stock mock | production page host | this harness |
|---|---|---|---|
| `NAVIGATE` | ignored, so `useCivitaiRoute()` never moves | app scope → `ROUTE_CHANGED` | reflects app-scoped navigations as `ROUTE_CHANGED` |
| `REQUEST_CONSENT` | grants any known scope, declared or not | grants only missing **declared** scopes | `consentGrantable` follows whether the manifest declares `user:read:self` |
| `GET_VIEWER` | answers with no scope check | refuses without `user:read:self` | not changed. The app never sends it without the scope |
| storage scopes | enforced from `declaredScopes` | enforced | manifest `scopes` passed as `declaredScopes` |

So removing `user:read:self`, `apps:storage:read` or `apps:storage:write` from
the manifest makes the harness refuse consent, loading or saving, as
production would.

`npm run dev:live` runs the app against the real backend. The live host also
reflects app navigation. This app spends no Buzz, but your storage writes are
real. See [the examples README](../README.md#against-the-real-backend-devlive).
See the [root README](../../../README.md) for submit → review → deploy.
