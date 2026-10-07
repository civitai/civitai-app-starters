# generation-kinds — the other `WorkflowBody` kinds

`buzz-workflow` runs `kind: 'textToImage'`. `useBuzzWorkflow()` takes the whole
`WorkflowBody` union, and this page app shows the kinds beyond that one, one
panel each, through the same money flow:

```
estimate(body) → quote on the button → click = confirm → submit(body) → poll(workflowId) until terminal
```

| Concept | Where |
|---|---|
| `kind: 'customComfy'`, recipe arm (`starter-comfy-txt2img`) | `src/ComfyPanel.tsx` |
| `kind: 'step'`, `step: 'chat-completion'`, multi-turn | `src/ChatPanel.tsx` |
| `useWildcardPack` feeding the Comfy prompt | `WildcardPicker` in `src/ComfyPanel.tsx` |
| Sign-in → consent → spend gate, `CONSENT_UNAVAILABLE` | `src/App.tsx` |
| Estimate/submit/poll error handling shared by both panels | `src/workflow.ts` |
| `page` block with `buzzBudgetPerGen`, `ai:write:budgeted` + its justification | `block.manifest.json` |

Host behaviour below is cited from **civitai/civitai at `494941446d`**. Paths
under `src/server/`, `src/pages/` and `src/components/AppBlocks/` are in that
repo, not this one. Line numbers drift, but the quoted error strings make good
search keys.

## Who can run this

🔴 **Apps on Civitai are an invite-only beta.** Every spend checks the per-user
`app-blocks-enabled` flag (`src/server/services/app-blocks-flag.ts:15` in
civitai/civitai, checked on every spend at `src/server/services/blocks/block-token-access.service.ts:161`).
Viewers outside it get a refusal, and this app shows it as a failed estimate.

Both kinds shown here are **page-only**. The host refuses them from a
model-slot token: `'customComfy recipes are page-only'` and `'registry steps are
page-only'` (`src/server/routers/blocks.router.ts:9184` and `:10113`). That is
why this example is a page app (`page` in the manifest, no `targets`), unlike
`buzz-workflow`.

Before either kind will even **estimate**, the host requires a signed-in viewer,
`ai:write:budgeted` on the token, and the beta flag (`blocks.router.ts:9178-9196`
for Comfy, `assertStepRequestAllowed` at `:10111` for steps). A page token is
minted *without* the consent scope, so `App.tsx` asks for it with
`requestConsent({ scopes: ['ai:write:budgeted'] })` first. It waits for the
refreshed token to carry the scope before any panel prices anything.

## The budget: `page.buzzBudgetPerGen`

A page app's per-run budget is its manifest's `page.buzzBudgetPerGen`. The host
maps it to the token's `buzzBudget` (`src/pages/api/v1/block-tokens/index.ts:1284-1291`),
clamps it to 1000, and **defaults to 10** when it is absent (`:183-184`). The
starter recipe's ceiling is 90 (see below), so with the default every Comfy
submit would be refused with `insufficient buzz budget: recipe ceiling 90
exceeds budget 10` (`blocks.router.ts:9430-9438`). This manifest sets **300**,
the same as the CLI's page-money template. It is a safety ceiling against a
runaway app, never a forecast, and you are charged the real cost.

## `customComfy`: a registered recipe

```ts
const body: WorkflowBodyCustomComfyRecipe = {
  kind: 'customComfy',
  recipe: 'starter-comfy-txt2img',
  params: { prompt: 'a lighthouse on a cliff at dusk' },
};
```

- The registry holds exactly two ids, `seamless-pano-360` and
  `starter-comfy-txt2img` (`src/server/services/blocks/recipes/index.ts:186-193`).
  An unregistered id is rejected at the schema.
- `starter-comfy-txt2img` accepts only `{ prompt (≤1500), seed?, accountType? }`,
  and the schema is `.strict()`, so any other key is rejected rather than dropped
  (`starter-comfy-txt2img.recipe.ts:100-107`).
- **Post-paid.** `estimate` returns the recipe's fixed *display* estimate, 15
  (`:63`, `:227`), so the button says "est.". Submit reserves the ceiling, 90
  Buzz and 90 s (`:89-92`), and the charge settles to measured runtime on the
  terminal snapshot. The panel shows that as "Charged N Buzz".
- Annotate the **arm** type (`WorkflowBodyCustomComfyRecipe`), not the union.
  With `mode` omitted, the union would accept an inline-arm key without
  complaint.

**The inline arm (`mode: 'inline'`, you ship the ComfyUI graph) is NOT shown.**
It *is* accepted from third-party page apps today, on the same gates and with no
developer or allowlist check (`blocks.router.ts:9178-9216`; the schema's own note
at `src/server/schema/blocks/workflow.schema.ts:381-391`). It is left out
because an inline graph has no code review: every viewer of your app runs
whatever graph you ship. It also needs an entitlement-checked `resources`
manifest and a `maxBuzz` that doubles as the step timeout in seconds. Read
[Comfy on Civitai](https://developer.civitai.com/apps/guide/comfy-cloud) and the
`WorkflowBodyCustomComfyInline` doc comment before you use it.

## `step` + `chat-completion`: a multi-turn chat

```ts
const body: WorkflowBodyStep = {
  kind: 'step',
  step: 'chat-completion',
  params: { model, messages, maxTokens: 512, temperature: 0.7 },
};
```

The SDK types `params` as opaque on purpose. The host's `.strict()` schema is the
authority (`src/server/services/blocks/steps/chat-completion.step.ts:1069-1118`):

- `model` is one of four allowlisted ids (`:474-482`). `ChatPanel` offers exactly those.
- `messages` holds 1–32 entries, each with 1–8000 characters of content. The panel
  re-sends the conversation each turn and keeps the system message plus the
  newest turns under 32.
- `maxTokens` is **required**, 1–4000 (`:538`). `temperature` is optional, 0–2.

**Price.** The estimate is a live quote, never below the 1-Buzz floor
(`CHAT_COMPLETION_PRICE_BUZZ`, `:267`; `blocks.router.ts:10397-10435`). It rises
with `maxTokens` and the model, so the button re-quotes every draft.

**The reply** arrives on the **poll** snapshot as `textOutputs`, which the host
has already moderated (`blocks.router.ts:4580`). It never comes on the submit
reply. A reply the scan kept back arrives as `textOutputWithheld.reason` instead,
a deliberately generic sentence, and the panel shows it.

**Not `@civitai/components-chat`.** `<civitai-chat>` is a complete assistant.
It runs on an `AppClient` from `@civitai/sdk` and talks to the orchestrator's
chat endpoint over MCP, so it never sends a `kind: 'step'` body. It is the right
tool for "put an assistant on my page", and the wrong one to demonstrate this
`WorkflowBody`.

## `useWildcardPack`: usable, but not a generation kind

`useWildcardPack(modelVersionId)` is a host bridge (`GET_WILDCARD_PACK`), not a
`WorkflowBody` kind. The page host resolves, downloads and parses the pack in the
viewer's own session (`src/components/AppBlocks/PageBlockHost.tsx:4136`, which
calls the session-authed, rate-limited `generation.resolveWildcardPack`,
`src/server/routers/generation.router.ts:184-200`). It needs no manifest scope
and no flag, only a signed-in viewer. Here it fills the Comfy prompt.
`WildcardPackError.code` is a closed set, so the panel branches on it.

## Not usable by a third-party app today: `kind: 'training'`

`WorkflowBodyTraining` exists in the SDK, but the host refuses it unless the
per-viewer flag `app-blocks-training-kind` is on (`blocks.router.ts:12024-12027`,
error `'training from apps is not enabled'`). That flag is false when unset
(`app-blocks-flag.ts:30-37`, `:1074-1080`). Training is also refused from dev and
review tokens (`blocks.router.ts:12001-12006`), so `dev:live` cannot reach it
either. Its quote is confirmed only through `useRunTraining()`'s host-chrome
dialog, and `useBuzzWorkflow().submit()` refuses the body. It is left out of the
code. The SDK's `WorkflowBodyTraining` doc comment describes the flow for when
it opens up.

## Mock host vs production

`npm run dev:harness` uses the SDK mock host. Where it diverges from production,
the code follows production:

| | Mock (`dev:harness`) | Production |
|---|---|---|
| Chat reply | **no `textOutputs`** (the mock has no text channel). The panel says so instead of showing a blank | moderated text on `textOutputs` |
| Comfy estimate / charge | 15 / 15 (set in `src/Harness.tsx`) | 15 display estimate; charge settles to runtime |
| Recipe id, chat params | not validated | `.strict()` schemas, unknown id or key rejected |
| Missing `ai:write:budgeted` | the mock ignores `declaredScopes` for this scope, so `src/Harness.tsx` passes `consentGrantable` from the manifest | host refuses consent for an undeclared scope (`CONSENT_UNAVAILABLE`) |
| Beta flag, page-only | not modelled | refused as above |

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5189
```

Click **Allow generation** (the mock grants it), then use either panel.
`?consent=granted` starts already granted, `?viewer=anon` shows the sign-in
gate, and `?theme=light` switches to the light theme.

`npm run dev:live` runs against the real backend and **spends your own Buzz**.
See [the examples README](../README.md#against-the-real-backend-devlive). A dev
token takes this manifest's `page.buzzBudgetPerGen`, capped at 250
(`src/server/services/blocks/dev-scoped-mint.service.ts:71`). That still covers
the recipe's ceiling of 90.
