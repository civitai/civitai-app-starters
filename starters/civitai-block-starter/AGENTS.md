# Agent Guide — `civitai-block-starter`

> **If you only read one thing:** this is a Vite + TypeScript SPA with **no UI
> framework**, iframe-embedded by civitai.com in a model-page slot. The host
> injects everything (token, context, viewer, theme) via `BLOCK_INIT`;
> `initialize()` from `@civitai/sdk` waits for it and returns `app`. The UI is
> `<civitai-*>` custom elements from `@civitai/components`. The demo
> (`src/block.ts`): `await initialize()`, build the view once, write slot +
> viewer + theme into it, update it in place on `app.onChange`, let
> `app.host.autoResize` drive the iframe height.

You're inside the Civitai App starter. The user copied this to bootstrap their
own block — there is **no monorepo around you**; the `@civitai/*` packages are
npm dependencies. Help them extend it.

If they want **React** instead, don't add it here. Point them at the Go
[`civitai` CLI](https://github.com/civitai/cli)'s React template
(`civitai app create <name>` — its default template, `page-money`, is
Vite + React + TS) or at the React examples under
`starters/examples/*` in the civitai-app-starters repo, which use the
`@civitai/blocks-react` hooks.

## Stack

- Vite + TypeScript strict, no framework, no JSX
- `@civitai/sdk` — the host bridge (`initialize`, `app.host`, `app.onChange`)
  plus the API clients (`app.site`, `app.storage`, `app.sharedStorage`,
  `app.orchestration`). Its README is the reference; read `app.host`'s methods
  from the installed types rather than from a list here.
- `@civitai/components` — the `<civitai-*>` elements. `import
  '@civitai/components/register'` in `src/block.ts` defines the generic kit:
  every element except the civitai.com vocabulary (`<civitai-avatar>`,
  `<civitai-media-card>`, `<civitai-rating-badge>`, `<civitai-reaction>`,
  `<civitai-tag>` — use `@civitai/components/register-site`, which includes the
  kit) and the two SDK-backed elements (`<civitai-sign-in-button>`,
  `<civitai-workflow-button>` — each needs its own
  `@civitai/components/<tag>/define`). The full contract
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
│   ├── block.ts            # the block: initialize → build view → fill (on every onChange) → autoResize
│   ├── directLoad.ts       # "Open on Civitai" card for a top-level (unembedded) load
│   ├── index.css
│   └── dev/harness.ts      # local BLOCK_INIT simulator (`npm run dev:harness`)
└── test/block.test.ts      # drives the block through the real bridge (happy-dom)
```

## Patterns to keep

- **Go through `@civitai/sdk`, never `window.parent`.** The bridge validates the
  parent origin, correlates replies and folds host pushes into one snapshot.
  Hand-rolled `postMessage` code skips all three.
- **Mount after `initialize()` resolves.** Until then the boot skeleton is the
  loading state. Read `app.context` / `app.theme` / `app.viewer` on every
  `fill` — they are live — and update the view in place from `app.onChange`.
- **Fail visibly.** `src/main.ts` calls `startBlock`, which shows an error in
  place of the skeleton if the block cannot start. Keep that wiring.
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
  users. For the viewer's identity, read the block route
  `app.site.get('blocks/me')`, not `app.viewer`. 🔴 Not `app.site.get('me')`:
  that is `/api/v1/me`, which authenticates sessions, API keys and OAuth
  tokens only, so the block token gets a 401. `blocks/me` needs `user:read:self` declared in
  `block.manifest.json` (this starter declares no scopes), and that scope is
  consent-gated — call `askConsent(app, ['user:read:self'])` (below) before
  the read. An anonymous viewer is refused, so gate on `isSignedIn` first.
- **Host data goes in with `textContent`, never `innerHTML`.** The view in
  `src/block.ts` is a static template filled field by field; a model name is
  user-authored, and interpolating it into markup is an XSS hole.
  `test/block.test.ts` pins this.
- **Register every element you use.** `@civitai/components/register` covers
  the generic kit only — see Stack above for the seven it does not define. An
  element nothing defines renders as an inert, unstyled tag with no error, so
  `test/block.test.ts` collects every `<civitai-*>` tag the starter uses and
  fails if one is undefined; keep it passing when you add elements or trim the
  import to per-element `…/<tag>/define` lines.
- **Keep `import '@civitai/sdk/safe-storage'` the first import in `src/main.ts`.**

## Boot skeleton

`block.manifest.json` declares `"bootSkeleton": true` and `index.html` paints a
matching skeleton inside `#root`. **They are ONE change — never keep one and
drop the other.** The key tells the full-page run host to stand down its own
loading UI; over an empty `#root` the viewer stares at a blank iframe for the
whole load. `tests/guards/boot-skeleton.test.mjs` in the monorepo blocks that.

- **Nothing removes the skeleton but the mount** — the one `root.replaceChildren`
  in `mountBlock` (`src/block.ts`). There is no framework clearing the container, so the
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
- **More UI** — add elements to the template in `src/block.ts` and set their
  host-derived text in `fill`. The view is built ONCE; `fill` re-runs on every
  `app.onChange` (including each token rotation, which changes nothing visible)
  and only updates text and visibility in place — never rebuild the view or
  `replaceChildren` there, or a host push wipes whatever the viewer typed
  (`test/block.test.ts` pins this). Wire element events (`change`, `click`, …)
  once, after the view is created, with `addEventListener`.
- **Host UI** (resource picker, Buzz purchase, image upload, navigation,
  sign-in) — `app.host.*`; each rejects with a `BridgeError` carrying a `code`.
- **Per-viewer storage** — `app.storage` (`get` / `set` / `list` /
  `getQuota`); refused for an anonymous viewer, so gate on
  `isSignedIn(app.viewer)`. Cross-viewer data: `app.sharedStorage`.
- **Money calls — two rules the React hooks used to apply for you.** `@civitai/sdk`
  has no Buzz-workflow or goods helper yet, so a block calls the `blocks/*`
  routes through `app.site` and owns both of these itself:
  1. **Consent first.** `ai:write:budgeted` and `goods:purchase:self` are
     CONSENT-GATED: the token lacks them until the viewer grants them in the
     host's dialog. Call `app.requestGrants([...])` before the call. It has
     FOUR outcomes:
     - resolves `true` — at once when the token already holds the scopes, or
       when the viewer grants them;
     - resolves `false` — the host says consent cannot be granted here;
     - waits — while the dialog is open. A viewer who DISMISSES it sends
       nothing, so without a `signal` it never settles;
     - 🔴 **REJECTS** with the signal's `reason` when the `signal` aborts — so the
       recommended `AbortSignal.timeout(60_000)` makes a dismissed dialog throw
       a `TimeoutError` after 60 s (an already-aborted signal rejects at once).
       Unhandled in a click handler, that is an unhandled rejection and any
       "pending" UI never resets.

     So: treat a `TimeoutError` / `AbortError` as "not granted", and reset
     pending UI in a `finally`. The `askConsent` helper below does the first;
     the snippets after it do the second. (`goods:read:self` is consent-exempt.)
  2. **One idempotency key per intent, reused on every retry.** Mint it BEFORE
     the first attempt and send the SAME value on any retry: a retry with a new
     key is a second reservation of the viewer's Buzz. The key must match
     `^[A-Za-z0-9_-]{1,64}$` — no colons; check one you compose yourself with
     `isValidBlockIdempotencyKey` from `@civitai/app-sdk/blocks`.
     `crypto.randomUUID()` conforms.
  ```ts
  import type { BlockAppClient, Scope } from '@civitai/sdk';

  /** `true` only when the viewer holds `scopes`; a timed-out or aborted wait is "not granted". */
  async function askConsent(app: BlockAppClient, scopes: Scope[]): Promise<boolean> {
    try {
      return await app.requestGrants(scopes, { signal: AbortSignal.timeout(60_000) });
    } catch (error) {
      // A dismissed dialog never answers, so the timeout fires and requestGrants REJECTS.
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return false;
      }
      throw error;
    }
  }
  ```
- **Buzz-spending generation** — add `ai:write:budgeted` to `scopes`, then:

  ```ts
  import type { BlockWorkflowSnapshot } from '@civitai/app-sdk/blocks';

  generateButton.addEventListener('click', async () => {
    generateButton.setAttribute('loading', '');
    try {
      if (!(await askConsent(app, ['ai:write:budgeted']))) return; // not granted: nothing was sent
      const idempotencyKey = crypto.randomUUID(); // once per generation, reused by any retry
      const reply = await app.site.post<{ snapshot: BlockWorkflowSnapshot; submissionUnconfirmed?: true }>(
        'blocks/workflows/submit',
        {
          body: workflowBody, // the workflow: steps + their inputs
          idempotencyKey, // REQUIRED on this route — the request is refused without one
        },
      );
      const { snapshot } = reply;
      // A REFUSAL IS AN HTTP 200, so it lands HERE, not in `catch`.
      if (snapshot.status === 'failed') {
        console.warn('submit failed:', snapshot.error); // server text: log it, never render it
        if (reply.submissionUnconfirmed) {
          // A training run the server could not confirm: it may be running, and charged.
          showMessage('This could not be confirmed and may still be running. Check before retrying.');
        } else if (snapshot.workflowId === 'failed') {
          // The placeholder id: refused before anything ran.
          showMessage('This generation could not start. Nothing was charged.');
        } else {
          // A real run that came back failed: Buzz may have been spent.
          showMessage('This generation failed. Check your history before trying again.');
        }
        return;
      }
      console.log(snapshot.workflowId); // a real run: poll it and render its progress here
    } catch (error) {
      console.error(error); // a non-2xx: an ApiError with `status` and `body`
      showMessage('Something went wrong. Please try again.');
    } finally {
      generateButton.removeAttribute('loading'); // reset on every outcome, a rejection included
    }
  });
  ```

  (`showMessage` stands for your own UI.) What lands where:
  - **Resolved, `status: 'failed'`.** The route answers **200**, and
    `app.site.post` throws only on a non-2xx, so without the `status` check a
    failed submit looks like a started run. Three kinds of reply resolve this
    way, and only the first may say "nothing was charged":
    1. the placeholder id `'failed'` — a spend cap or limit refused it before
       anything ran;
    2. `submissionUnconfirmed: true` beside the snapshot — a training run the
       server could not confirm, which may be running and may have spent;
    3. a real `workflowId` — a run was created and came back failed, and Buzz
       may have been spent.

    The complete list of caps and replies is in `@civitai/blocks-react`'s
    [`useBuzzWorkflow` `submit` docs](https://github.com/civitai/civitai-app-starters/blob/main/packages/civitai-blocks-react/src/hooks/useBuzzWorkflow.ts)
    (search "THE ONE COMPLETE LIST"); keep it there, not here. A refusal can
    carry **no `cost`** (an unpriced training step), so check before reading
    `cost.total`. `snapshot.error` is unsanitised server text — log it, show
    your own copy. 🔴 **Never offer a Buzz top-up here**: buying Buzz raises
    none of those caps.
  - **Rejected — `catch`.** A non-2xx `ApiError`. This is where a viewer who is
    genuinely **out of Buzz** lands (the orchestrator refuses the run; the route
    answers 400), but so does any other bad request, with nothing structural to
    tell them apart. If you want to offer a top-up (`app.host.openBuzzPurchase()`),
    decide from the viewer's SPENDABLE balance, not from the rejection:
    `app.site.get('blocks/buzz')` returns `{ blue, green, yellow }`, needs
    `buzz:read:self` declared in `block.manifest.json` (consent-gated, so
    `askConsent` it first) and refuses an anonymous viewer. A block spends only
    blue plus its domain's pool — green under an SFW ceiling, yellow under a
    mature one — so compare `blue` plus `isSfwCeiling(maxBrowsingLevel) ? green
    : yellow` (`isSfwCeiling` from `@civitai/app-sdk/blocks`;
    `getTransport().snapshot.get().maxBrowsingLevel` from `@civitai/sdk`, the
    domain ceiling the server keys on) against the quoted cost, never all
    three.

  🔴 Do **not** call `app.orchestration` from a block: a direct orchestrator call
  skips the per-call budget, the daily caps and attribution (the `@civitai/sdk`
  README explains). The host caps each generation at the token's `buzzBudget`
  — for a model-slot app like this one that comes from the install's
  per-generation setting; for a page app, from `page.buzzBudgetPerGen`.
  - 🔴 **The per-gen budget is a SAFETY CEILING, not a cost estimate.** Set it to
    several times your worst-case run. A submit priced above it is refused — the
    `status: 'failed'` snapshot above, with an `insufficient buzz budget` error —
    nothing charged and nothing delivered, and for a page app it stays broken
    until a new manifest version is approved.
  - The `buzz-workflow` example in the civitai-app-starters repo is a complete
    estimate → submit → poll flow, in React through the host bridge; this REST
    route forwards to the same server procedure.
- **Selling something (digital goods)** — declare a `goods` array in
  `block.manifest.json`, add `goods:purchase:self` (to sell) and
  `goods:read:self` (to read entitlements back) to `scopes`. Each good is
  `{ id, title, priceBuzz }` plus an optional `description`; `priceBuzz` is
  whole Buzz, 2–50000, at most 32 goods per manifest. Then:

  ```ts
  // `@civitai/sdk`'s Scope type does not list the goods scopes yet, hence the cast.
  const purchaseScope = 'goods:purchase:self' as Scope;

  buyButton.addEventListener('click', async () => {
    buyButton.setAttribute('loading', '');
    try {
      if (!(await askConsent(app, [purchaseScope]))) return; // not granted: nothing was charged
      const idempotencyKey = crypto.randomUUID(); // once per purchase, reused by any retry
      const purchase = () =>
        app.site.post('blocks/goods/purchase', { goodId: 'extra-slots', expectedPriceBuzz: 250, idempotencyKey });
      await purchase(); // on a timeout, `await purchase()` again — same key, so it cannot charge twice
      const { entitlements } = await app.site.get<{ entitlements: unknown[] }>('blocks/entitlements');
      console.log(entitlements); // show what the viewer now owns
    } catch (error) {
      console.error(error); // a refusal is an ApiError with `status` and `body`
    } finally {
      buyButton.removeAttribute('loading');
    }
  });
  ```

  - 🔴 **`id` is what an entitlement is keyed by.** Renaming it orphans every
    entitlement already granted under the old id.
  - 🔴 **The catalog is REVIEW-GATED** — a price change is a new manifest version
    and a new review, like a scope change.
  - **Pass `expectedPriceBuzz`**: the server charges its own price and refuses
    when yours disagrees, so a stale price becomes a clean refusal.
  - A purchase can be refused at a perfectly legal price (the viewer has a
    daily ceiling across apps) — handle the 4xx (`ApiError`, with `status` and
    `body`).

## Verifying changes

| You touched | Run |
|---|---|
| `src/**` | `npm run typecheck && npm test`, then `npm run dev:harness` and look |
| `vite.config.ts`, env wiring | `npm run build` |
| `block.manifest.json` | `npm run build` (the manifest is validated on every dev boot and build); before submitting, `civitai app validate` |

Before `civitai app submit`, self-run the [first-review checklist](https://developer.civitai.com/apps/guide/first-review.md) — what a reviewer checks first.
