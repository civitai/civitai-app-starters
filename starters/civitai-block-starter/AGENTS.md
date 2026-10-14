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
  plus the API clients (`app.site`, `app.workflows`, `app.storage`,
  `app.sharedStorage`, `app.orchestration`). A block generates with
  `app.workflows`, never `app.orchestration` (see Extending). Its README
  (`node_modules/@civitai/sdk/README.md`) is the reference; read `app.host`'s
  methods from the installed types rather than from a list here.
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
- **Money calls — two rules the React hooks used to apply for you.** Generation
  goes through `app.workflows`; `@civitai/sdk` has no goods helper yet, so a
  purchase calls the `blocks/goods/*` routes through `app.site`. Neither asks
  for consent or mints a key for you, so a block owns both of these itself:
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
     the first attempt, keep it until that intent has a known outcome, and send
     the SAME value on any retry: a retry with a new
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
- **Buzz-spending generation** — add `ai:write:budgeted` to `scopes`, then use
  `app.workflows`: `estimate`, `submit`, `get`, `watch`, `wait`, `cancel` and
  `list`. It calls the host's `/api/v1/blocks/workflows/*` routes for you. Do
  not hand-roll those through `app.site`: that returns the raw reply, where an
  unconfirmed run (below) is shaped exactly like a plain refusal.

  ```ts
  import {
    ApiError,
    SubmissionUnconfirmedError,
    type BlockWorkflowSnapshot,
    type WorkflowBody,
  } from '@civitai/sdk';

  generateButton.addEventListener('click', async () => {
    generateButton.setAttribute('loading', '');
    try {
      if (!(await askConsent(app, ['ai:write:budgeted']))) return; // not granted: nothing was sent

      // 1. Price it. Nothing is charged or reserved. A refusal RESOLVES, with no `cost`.
      const estimate = await app.workflows.estimate(workflowBody);
      if (estimate.status === 'failed') {
        console.warn('estimate refused:', estimate.errorCode, estimate.error); // server text: log it, never render it
        showMessage('This generation could not be priced.');
        return;
      }
      if (!(await confirmSpend(estimate.cost?.total))) return; // the viewer said no: nothing was sent

      // 2. ONE key for this press, minted HERE (outside `submitOnce`) so that a
      //    retry re-sends the SAME key. Never mint one inside the retry.
      const idempotencyKey = crypto.randomUUID();
      let outcomeUnknown = false; // has any attempt for this press ended without a known outcome?

      const submitOnce = async (): Promise<void> => {
        let submitted: BlockWorkflowSnapshot;
        try {
          submitted = await app.workflows.submit(workflowBody, { idempotencyKey });
        } catch (error) {
          outcomeUnknown = true;
          if (error instanceof SubmissionUnconfirmedError) {
            // The run MAY be running and MAY have been charged. Do not resubmit:
            // look for it with `app.workflows.list()`.
            showMessage('We could not confirm this run. It may still be running. Check your history.');
          } else {
            // An ApiError (a 5xx, a 409, …) or no answer at all: UNKNOWN, not
            // "failed". Retry calls submitOnce() again with the SAME key.
            console.error(error instanceof ApiError ? error.status : error);
            showRetry('We could not confirm this started.', submitOnce);
          }
          return;
        }
        // A REFUSAL IS AN HTTP 200, so it lands HERE, not in `catch`.
        if (submitted.status !== 'failed') {
          await follow(submitted.workflowId); // 3. started: follow it to a final status
        } else if (submitted.workflowId !== 'failed') {
          // A real run that came back failed: Buzz may have been spent.
          console.warn('submit failed:', submitted.errorCode, submitted.error);
          showMessage('This generation failed. Check your history before trying again.');
        } else if (outcomeUnknown) {
          // THIS attempt was refused, but an earlier one for this press may have
          // started a run. Look for it with `app.workflows.list()`.
          showMessage('We could not confirm this started. Check your history.');
        } else {
          // The placeholder id on a FIRST attempt: refused before anything ran.
          console.warn('submit refused:', submitted.errorCode, submitted.error);
          showMessage('This generation could not start. Nothing was charged.');
        }
      };
      await submitOnce();
    } catch (error) {
      console.error(error); // consent, the estimate or a read failed. Never "nothing was charged" here.
      showMessage('Something went wrong. Check your history before trying again.');
    } finally {
      generateButton.removeAttribute('loading'); // reset on every outcome, a rejection included
    }
  });

  async function follow(workflowId: string): Promise<void> {
    try {
      const done = await app.workflows.wait(workflowId); // the final snapshot, whichever status it is
      if (done.status === 'succeeded') showImages(done.imageUrls ?? []);
      else showMessage('This generation did not finish. Check your history before trying again.');
    } catch (error) {
      // Reading the run failed. That says nothing about the run: do NOT resubmit.
      console.error(error);
      showMessage('We lost track of this generation. It may still be running. Check your history.');
    }
  }
  ```

  (`workflowBody` is your `WorkflowBody`; `confirmSpend`, `showMessage`,
  `showImages` and `showRetry` stand for your own UI, and `showRetry` must
  handle what the function it is given rejects with.) What lands where on
  `submit`:
  - **Resolved, `status: 'failed'`.** The host answers a refusal with **200**,
    so `submit` resolves and, without the `status` check, a failed submit looks
    like a started run. It is one of two things, told apart by `workflowId`,
    and only the first may say "nothing was charged":
    1. the placeholder id `'failed'` — the host refused THIS request before
       submitting it (a spend cap, a limit, a body it will not run). 🔴 That
       means nothing was charged **only on the first attempt for a press**. It
       says nothing about an earlier attempt for the same press that ended
       unknown, which is what `outcomeUnknown` tracks;
    2. a real `workflowId` — a run was created and came back failed, and Buzz
       may have been spent.

    The complete list of caps and replies is in `@civitai/blocks-react`'s
    [`useBuzzWorkflow` `submit` docs](https://github.com/civitai/civitai-app-starters/blob/main/packages/civitai-blocks-react/src/hooks/useBuzzWorkflow.ts)
    (search "THE ONE COMPLETE LIST"); keep it there, not here. A refusal can
    carry **no `cost`** (an unpriced training step, any refused estimate), so
    check before reading `cost.total`. `snapshot.error` is unsanitised server
    text — log it, show your own copy; branch on `errorCode` when the refusal
    defines one. 🔴 **Never offer a Buzz top-up here**: buying Buzz raises none
    of those caps.
  - **Rejected with `SubmissionUnconfirmedError`.** The host could not learn
    whether the run was created, which it reports for a `kind: 'training'` body
    or a step body carrying a `quoteId`. The run may be running and may have
    been charged, and the host has **kept** the budget it reserved. Do not say
    nothing was spent and do not resubmit as a reflex: a second submit reserves
    that budget again and may start a second run. Look for the run with
    `app.workflows.list()` first. `error.snapshot`, when present, is
    refusal-shaped; its `workflowId` is a placeholder, not something to poll.
  - **Rejected with anything else — the outcome is UNKNOWN.** An `ApiError`
    with the HTTP `status` (a `5xx`, a `409`, …), a `CivitaiError`, or whatever
    `fetch` threw when no answer arrived. 🔴 None of them means "not started":
    the reply does not say whether the rejection came before or after the
    orchestrator was called. Do one of two things, and never mint a new key for
    that press:
    1. retry `submit` with the **same** `idempotencyKey` (after a `409`, wait
       first: the earlier attempt is still in flight);
    2. or look for the run with `app.workflows.list()` before treating the
       press as failed.

    Matching a repeated key to an existing run is the host's work and is not
    guaranteed, so when a retry is late or fails again, `list()` is the check
    to trust before telling the viewer nothing ran.
  - 🔴 **For a `kind: 'training'` body and a step body carrying a `quoteId`, the
    key is NOT the run's identity.** The host identifies those runs by the
    confirmed quote or the training run, so a submit naming a new quote is a
    new run whatever key it carries. After an unknown outcome on one of these,
    check `app.workflows.list()` **before** asking the viewer to confirm
    another quote. (Both kinds also need a quote the viewer confirmed in the
    host's own dialog; `app.workflows` has no call for that step.)
  - **Out of Buzz is a rejection too**, with nothing structural to tell it
    apart from the others — the orchestrator refuses the run and `submit`
    rejects. If you want to offer a top-up (`app.host.openBuzzPurchase()`),
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

  The rest of the client:
  - **`watch(workflowId)`** is the async iterator behind `wait`: the workflow
    now, then each time it changes, until a final status. Use it to render
    progress, and read its doc comment in the installed types before rendering
    a snapshot that carries no steps. A `failed` final snapshot can still have
    `cost` and `imageUrls`: steps that finished before the failing one stay
    charged and keep their output.
  - **`cancel(workflowId)`** stops the run on the orchestrator and resolves the
    workflow as it now stands. Read its `status` rather than assuming
    `'canceled'`.
  - **`list({ cursor?, limit? })`** resolves `{ workflows, cursor }`: a page of
    the workflows this app ran for this viewer.
  - The body kinds, multi-step bodies with `{ $ref, path }` references and the
    reasoning behind every rule above are in
    `node_modules/@civitai/sdk/README.md` — "Multi-step workflows", "A refusal
    is an answer, not a throw", "When a submit rejects: the outcome is
    unknown", "When a submit could not be confirmed" and "The idempotency key".
    Read those rather than a restatement here.

  🔴 **`app.workflows` needs the block token**, which is what this starter is
  handed. A block that declares `auth: "oauth"` in `block.manifest.json` and is
  handed an OAuth access token is answered `401` on every `app.workflows` call,
  so do not add that key to a block that generates this way.

  🔴 Do **not** call `app.orchestration` from a block: a direct orchestrator call
  skips the per-call budget, the daily caps and attribution (the `@civitai/sdk`
  README explains). The host caps each generation at the token's `buzzBudget`
  — for a model-slot app like this one that comes from the install's
  per-generation setting; for a page app, from `page.buzzBudgetPerGen`.
  - 🔴 **The per-gen budget is a SAFETY CEILING, not a cost estimate.** Set it to
    several times your worst-case run. A submit priced above it is refused — the
    `status: 'failed'` placeholder snapshot above, with an `insufficient buzz
    budget` error — nothing charged and nothing delivered, and for a page app it
    stays broken until a new manifest version is approved.
  - The `buzz-workflow` example in the civitai-app-starters repo is a complete
    estimate → submit → poll flow, in React through the host bridge; the submit
    route `app.workflows.submit` calls forwards to the same server procedure.
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
