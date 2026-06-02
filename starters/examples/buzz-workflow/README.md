# buzz-workflow — generate + bill Buzz

The money feature: run an orchestrator generation from a block and charge the
viewer's Buzz, host-mediated. This is the example to copy for any generation UI.

## What it shows

| Concept | Where |
|---|---|
| `useBuzzWorkflow()` — estimate / submit / poll | `src/App.tsx` |
| **GOTCHA #59** — estimate params must mirror submit (esp. the seed) | `buildBody()` |
| **GOTCHA #8/#9/#10** — status semantics + caller-driven polling | `src/App.tsx` |
| **GOTCHA #19** — round dimensions to /64 | `round64()` |
| Non-blocking queue + per-job cancel | `src/App.tsx` |
| `ai:write:budgeted` scope + `buzzBudget` | `block.manifest.json` |

## The flow

```
estimate(body)  → status 'estimating' → 'confirming'   (CTA shows the cost)
submit(body)    → status 'submitting' → 'polling'       (returns a workflowId)
poll(workflowId)→ status 'polling' → 'done'             (CALLER loops on a backoff)
```

All three go through the host's postMessage bridge — the block never holds an
orchestrator token. The host enforces the budget (`cost ≤ token.buzzBudget`)
before forwarding; `submit` rejects if the host refuses (that's your cue to call
`useBuzzPurchase().openPurchaseModal()` — see the `buzz-purchase` example).

## GOTCHA #59 — the estimate must match submit exactly

The orchestrator's whatif prices a **cache hit** (the exact workflow already
generated) at **0** and a fresh job at full cost — and the **seed** decides
cache-hit-ness. If your estimate builds params one way and submit another (a
classic: estimate uses a fixed seed, submit randomizes), the CTA quotes 0 while
submit charges full.

The fix is structural: **one shared param builder**, both estimate and submit
call it with the same `randomize` decision read from the same state:

```tsx
const buildBody = (randomize: boolean) => ({
  kind: 'textToImage', modelId, modelVersionId,
  params: { prompt, steps: 25, width: round64(1024), height: round64(1024),
            ...(randomize ? {} : { seed: 1234567 }) },  // omit seed = randomize
});

// estimate effect AND submit both use buildBody(isRegenerate) — can't drift.
```

`isRegenerate` flips true after the first generation (the next Generate re-gens
→ a fresh seed → full cost), and it's in the estimate effect's deps so the CTA
re-quotes *before* the next click.

## GOTCHA #8/#9/#10 — status + polling

- `status === 'confirming'` is **idle** (estimate landed, user reviewing) — keep
  the Generate button enabled. Only `estimating | submitting | polling` are busy.
- `result` is populated after `estimate()` too — don't treat a non-null result
  as "something is queued".
- The hook does **not** auto-poll. After `submit` flips status to `'polling'`,
  the caller runs a `useEffect` that calls `poll(workflowId)` on a backoff until
  the snapshot is terminal (`succeeded | failed | canceled | expired`).

## Cancel

This example does a **client-side** cancel (stop polling + clear the card). In
`@civitai/blocks-react >= 0.5.0` the hook also exposes `cancel(workflowId)` for a
**real server-side orchestrator cancel** (gotcha #51) so a running workflow stops
spending Buzz:

```tsx
const { cancel } = useBuzzWorkflow();      // available in published 0.5.0+
if (item.workflowId) cancel(item.workflowId).catch(() => {}); // best-effort
```

> The workspace SDK this monorepo builds against may predate `cancel`. The code
> here uses the client-side half only so it compiles everywhere; add the
> `cancel(...)` call once you're on a published 0.5.0+ SDK.

## Run it

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5182
```

The harness mocks the orchestrator: it prices a seed it has already "generated"
at 0 (cache hit) and a fresh seed at 120 Buzz, so you can watch the CTA go from
`free (cache hit)` on the first Generate to `120 Buzz` on the re-gen — exactly
the #59 behavior. See the [root README](../../../README.md) for submit → review →
deploy.
