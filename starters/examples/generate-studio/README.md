# generate-studio — real image generation in a page app

The biggest example: a full-page generator. The viewer picks a checkpoint and
LoRAs in Civitai's own pickers, writes a prompt (or uploads an image to start
from), sees the price, and generates. Their runs stream in, the app's own
history lists everything it made for them, and outputs are shown only as far as
the viewer may see them. Finished outputs can be saved or published.

It is a **page app**: it declares `page`, not `targets`. Spending Buzz
(`ai:write:budgeted`) is a page affordance (the CLI warns a slot block that
declares it), and LoRAs and source images are refused on a model-slot token
anyway.

> **Closed beta.** In production this is mod-gated end to end. The page route and
> page-token mint sit behind the `appBlocks` + `appBlocksPages` flags, and every
> bridge call checks `app-blocks-enabled` for the viewer. Everything below runs
> locally against the mock host. See [What is not usable today](#what-is-not-usable-today).

## The guided tour

Read the files in this order. Each one is small and owns one idea.

| # | File | What it shows |
|---|---|---|
| 1 | `block.manifest.json` | the `page` block, `page.buzzBudgetPerGen`, two consent-gated scopes and their `scopeJustifications` |
| 2 | `src/studio/setup.ts` | the setup state and **`buildBody`**, the only function that builds a `WorkflowBody` |
| 3 | `src/components/ModelSection.tsx` | `useCheckpointPicker`, `useResourcePicker` (LoRAs), `useGenerationResources` (setup codes) |
| 4 | `src/components/SourceImageSection.tsx` | txt2img vs img2img: `useImageUpload({ purpose: 'generationSource' })` → `sourceImage` |
| 5 | `src/components/PromptSection.tsx` | the parameters, bounded exactly like the server |
| 6 | `src/studio/useQuote.ts` | `estimate()` on every change (debounced), `WorkflowEstimateError` by `code` |
| 7 | `src/studio/blocker.ts` + `src/components/SpendBar.tsx` | budget vs wallet, `useBuzzBalance`, `useBuzzPurchase` |
| 8 | `src/studio/useRuns.ts` + `src/studio/copy.ts` | `submit()` → `watch()` → `cancel()`, `WorkflowSubmitError` by `code` |
| 9 | `src/components/History.tsx` | `useAppWorkflows` (list + cancel), `usePublishGenerationOutputs`, `<SfwGate>` |
| 10 | `src/components/OutputImage.tsx` + `Published.tsx` | `useDomainMaturity`, `useGatedImages`, `useSaveImage` |
| 11 | `src/App.tsx` | wiring: consent, sign-in, layout |
| 12 | `src/Harness.tsx`, `src/dev/fixtures.ts`, `vite.config.ts` | the mock host, and how it is made to refuse what production refuses |

### 1. The manifest

```json
"scopes": ["ai:write:budgeted", "buzz:read:self"],
"page": { "path": "/", "title": "Generate Studio", "buzzBudgetPerGen": 1000 }
```

`page.buzzBudgetPerGen` is the **per-generation safety ceiling** the token mint
signs into `token.buzzBudget`. It is not a price forecast. If it is missing it
defaults to **10**, which is below almost any real generation. Values above
**1000** are clamped down to 1000. A value ≤ 0 is refused (civitai
`src/pages/api/v1/block-tokens/index.ts:183-184, 344-360, 1284-1291, 1549-1557`).
1000 is the cap, and a generous value costs nothing: you are charged the real
price. A submit priced above the budget is refused before it runs, for every
viewer, until you ship a new version.

Both scopes are consent-gated. The token carries a scope only when it is
declared, approved **and** granted. A signed-out viewer gets none
(`block-tokens/index.ts:1440-1528`).

### 2. One body builder

`buildBody(setup)` is the only place a body is built. The estimate effect and
the submit both call it, so the quoted price is the price of what the click sends
(gotcha #59: the seed decides cache hits, so a builder that drops the seed for
the estimate quotes a cache hit and then charges full price). Inside:

- `additionalResources` holds the LoRAs: at most 5, each with `strength` in [-1, 2]. It is omitted when empty.
- `sourceImage` is sent only in img2img mode. Use the **singular** field: it
  works on every host. A host older than civitai/civitai#3518 *silently strips*
  `sourceImages` and bills a plain txt2img. Never send both fields.
- dimensions are rounded to /64 (gotcha #19). In img2img mode the source image's
  own size drives the graph.
- `seed` is omitted for "random", and the estimate makes the same choice.

A page slot carries no model, so the app starts on a known-good checkpoint
(SDXL 1.0, the same default as the `civitai app init` page template).

### 3. Pickers, LoRAs and setup codes

- **Checkpoint**: `useCheckpointPicker().open({ currentVersionId })` with **no
  `baseModelGroup`**. That option is a filter, so passing the current family
  would trap the viewer in it. `persist()` is **not** used, because a page host
  always refuses it: *"page blocks cannot persist a checkpoint override (no model
  binding)"* (civitai `src/components/AppBlocks/PageBlockHost.tsx:4093-4104`).
- **LoRAs**: `useResourcePicker().open({ resourceType: 'LORA', baseModelGroup:
  checkpoint.baseModel })`. The family comes from the checkpoint and is never a
  literal. This picker exists on page apps only (`PageBlockHost.tsx:3747`). The
  slider range is the LoRA's own recommended clamp, kept inside [-1, 2].
- **A new checkpoint drops LoRAs from another family**, and says so. Otherwise the
  next estimate fails with nothing on screen to explain it.
- **Setup codes** (`128078 + 666002@0.8`) carry ids and weights only. **Load**
  rehydrates them with `useGenerationResources().fetch(ids)`, which is a direct
  REST call (`GET /api/v1/blocks/generation-resources`, block token as Bearer),
  not a bridge message. The endpoint *omits* what this viewer cannot use, so the
  app matches rows by id and reports how many went missing. Rehydrated ids are
  hints, just like picked ones.

Every pick is **discovery only**. The server re-validates and re-prices each id
at estimate and submit.

### 4. img2img

`useImageUpload({ purpose: 'generationSource' })` opens the host's upload
chrome. It resolves to `{ url, width, height }`, a private, Civitai-hosted image
that is unscanned until the orchestrator scans it at generation time. Only
Civitai-hosted https URLs are accepted as a source. The checkpoint's ecosystem
decides whether you get plain `img2img` or an edit graph; no body field
overrides that. **Page apps only.**

### 6. The quote

`useQuote` calls `estimate(body)` 350 ms after the last change.

- **It runs only once the token holds `ai:write:budgeted`.** In production the
  estimate needs the same scope as the submit (civitai
  `src/server/routers/blocks.router.ts:6047`). It never prompts for consent, so
  before the grant it would just fail.
- An unusable estimate **rejects** with `WorkflowEstimateError`. Branch on
  `code`: `'failed'` (log `err.snapshot.error`, never render it) or
  `'no-cost'`. Anything else means the request itself did not complete.

### 7. Budget vs wallet

| Limit | Read from | Does buying Buzz raise it? |
|---|---|---|
| per-generation **budget** | `useBlockContext().token.buzzBudget` | **no**, only a new manifest version does |
| the viewer's **wallet** | `useBuzzBalance()` (`buzz:read:self`) | **yes** |

`findBlocker(price, budget, balance)` decides from the **numbers**, never from a
refusal's wording:

- **Over budget**: Generate is disabled, the message says why, and no purchase is offered.
- **Wallet short**: Generate is disabled and the app offers **Buy N Buzz**
  (`useBuzzPurchase().openPurchaseModal(N)`, guarded by a ref).

After a purchase the app re-reads the balance and does **not** auto-retry. The
modal waits on a human for up to ten minutes, so a retry fired from its promise
would be a paid submit at a moment nobody chose. `buzz-purchase` shows the
guarded auto-retry if you want one.

The budget only appears on the token after consent. The app therefore asks
first, with an **Allow** button (`useRequestConsent`). The host grants every
declared scope still missing in one dialog (`PageBlockHost.tsx:1865-1868`).

### 8. Runs: submit → watch → cancel

`useRuns` keeps a queue, so several runs can be in flight at once.

- `submit(body)` with **no `idempotencyKey`**: every click is a new logical
  submit, and the hook mints a valid key. Its single automatic consent retry
  reuses that key.
- **A priced refusal resolves**, with `status: 'failed'` and a `cost`. The host
  declined before spending: budget, a daily or per-app cap, velocity, a missing
  quote, or a wallet it could not debit. The run says *"Not started — nothing was
  charged"*, and the SpendBar explains the cause from the numbers.
- **A rejection** is a `WorkflowSubmitError`, and its `code` says what you may
  assume about money:
  - `'workflow-failed'`: a workflow probably exists, so watch its id (unless it
    is `'whatif'`) instead of inviting a retry.
  - `'exception'`: re-read the wallet. A short wallet surfaces here in production.
  - anything else: it may have been charged, so the app uses the most cautious copy.
- **`watch(workflowId, { signal, onUpdate })`** owns the polling loop. It is
  sequential, keeps one request in flight, and resolves on the terminal
  snapshot. It replaces the hand-written `poll()` + backoff loop in
  `buzz-workflow`. Aborting the signal stops *watching*. It does not stop the
  workflow.
- **Cancel** calls `cancel(workflowId)`, a real server-side stop scoped to
  workflows the viewer owns.

`snapshot.error` and `err.message` are logged and never rendered. Every
viewer-facing string is the app's own (`copy.ts`).

### 9. History and publishing

`useAppWorkflows({ limit: 20 })` lists the generations **this app** made for the
viewer, newest first and across reloads. The host forces the per-app filter and
drops prompts, params and resources. `cancel()` stops a pending row in place.
Both need `ai:write:budgeted` (`blocks.router.ts:4957, 5057`). After a run
settles, the app re-reads the history and the wallet.

**Publish** calls `usePublishGenerationOutputs().publish({ workflowId,
imageIndexes })`. It names *indexes into this list's `images`*, never URLs. The
host shows a confirm, re-uploads the outputs and fully scans them, and returns
`Image` ids (`blocks.router.ts:5174-5224`, `PageBlockHost.tsx:2461-2503`). It
also needs `ai:write:budgeted` (`blocks.router.ts:5191`).

### 10. Showing outputs

`OutputImage` asks `useDomainMaturity().isLevelAllowed(nsfwLevel)`. That checks
the domain ceiling **intersected with the viewer's own setting**, and it fails
closed to SFW before `BLOCK_INIT`.

| The image is… | Shown as |
|---|---|
| rated, level not allowed | a placeholder; the pixels are never rendered |
| rated, allowed, above PG-13 | blurred until clicked (togglable) |
| rated, allowed, PG / PG-13 | shown |
| **not rated yet** (`nsfwLevel: null`, or `ratingPending`) | shown with a *not rated yet* badge, and never treated as "G" |

Unrated images are only ever the viewer's own outputs. Showing them matches the
host's own posture: its gated read hands a viewer their own unrated image.

- **`<SfwGate level={BrowsingLevel.R}>`** renders the *Unblur mature* toggle only
  where R can be shown at all.
- **Published** reads the ids back through `useGatedImages().getImages(ids)`, the
  per-viewer, server-clamped read (no scope, signed-in viewer;
  `block-gated-images-read.service.ts:100-131`). It renders `hidden` entries
  (which never carry a URL) as placeholders, and `ratingPending` entries with no
  rating.
- **Save** calls `useSaveImage().saveImage({ url })`. The *host* downloads the
  file, because a sandboxed iframe has no `allow-downloads`. It accepts only
  Civitai's image and orchestration hosts, which is where outputs live
  (`src/components/AppBlocks/saveImageDownload.ts:31-61`).

### Layout

The layout is full width, with no max-width box:

- **Phone:** one column.
- **≥ 900 px:** controls (340–420 px) sit beside a results column that takes every
  remaining pixel.
- **≥ 1800 px:** the controls widen to 380–480 px.

The output grid adds columns as the page widens; it does not stretch a few
images.

## What is not usable today

| Feature | Status | Why |
|---|---|---|
| **`useCreatePostFromApp`** (post to the viewer's profile) | **not used: dark for everyone** | `createPostFromApp` checks the `app-blocks-post-creation` flag, which ships absent, so it is off for every viewer, moderators included: *"posting from apps is not enabled"* (civitai `blocks.router.ts:636-641`, `src/server/services/app-blocks-flag.ts:1044-1052`). It would also need `posts:write:self`, so this manifest does not declare that scope. **Publish** (a bare, scanned `Image`) is the usable route. |
| `useCheckpointPicker().persist()` | always refused on a page | see §3 |
| everything, for a non-moderator | closed beta | the `appBlocks` / `appBlocksPages` mod-only flags gate the route and mint; `app-blocks-enabled` gates every bridge call; `app-blocks-runtime-enabled` gates the REST rehydrate (civitai `src/server/services/feature-flags.service.ts:576, 616`; `block-token-access.service.ts:119-163`) |

The citations are civitai/civitai `main` at `494941446d`.

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5188
```

The flow: **Allow**, then Change / Add LoRA, then Generate and watch the run
finish. Cancel a run while it generates, Publish a history row, and Save an
output. You can also paste the setup code `900001 + 900101@0.5, 900102@1.2`.

URL knobs:

- `?consent=granted` skips the Allow step.
- `?viewer=anon` shows the sign-in prompt.
- `?theme=light`
- `?domain=red` sets a mature surface: R outputs are shown blurred and the toggle appears.
- `?price=1500` puts the price over the 1000 budget, so no top-up is offered.
- `?balance=10` makes the wallet short, so a top-up is offered.
- `?insufficient=1` makes the submit reject with `'exception'`, as production does when the viewer is out of Buzz.
- `?capRefusal=1` produces a priced spend-cap refusal that resolves.
- `?failNext=1` makes the submit reject with `'exception'`.

### Where the mock host differs from production

- **It enforces `declaredScopes` only for storage.** If you delete
  `buzz:read:self` or `ai:write:budgeted` from the manifest, the SDK mock keeps
  answering. Production would refuse every call (`block lacks <scope> scope`).
  `refusalsForUndeclaredScopes` in `src/Harness.tsx` maps each missing scope
  onto the mock knob that produces production's refusal, so the harness fails
  the way the host does.
- **It does not enforce the budget at submit, and it does not need consent to estimate.** The app
  checks the budget from the numbers itself and prices only once the token
  holds the scope, so both paths reach the same screen.
- **Its history is static.** `appWorkflows` comes from `src/dev/fixtures.ts`.
  Your own submits do not appear in it, as they would in production.
- **It cannot answer `useGenerationResources`.** That hook is REST, not a bridge
  message. Under `dev:harness` only, `vite.config.ts` registers a small
  stand-in for the endpoint, served from the fixtures. It requires a Bearer and
  omits unknown ids, like the real endpoint.
- **It answers `useBuzzBalance` from fixed numbers.** A purchase does not change
  them.

`npm run dev:live` runs the app against the real backend and **spends your own
Buzz**. The live host refuses consent, upload, purchase, publish and save,
because those need the real signed-in page. See
[the examples README](../README.md#against-the-real-backend-devlive) and the
[root README](../../../README.md) for submit → review → deploy.
