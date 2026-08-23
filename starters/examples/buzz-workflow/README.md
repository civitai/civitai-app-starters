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
before forwarding.

🔴 **A budget refusal does NOT reject — it RESOLVES**, as a snapshot with
`status: 'failed'`, an `error` string, and the `cost` the server declined to
charge. That resolved shape is your cue to call
`useBuzzPurchase().openPurchaseModal()` — see the `buzz-purchase` example. Note
that affordability is only *some* of the priced refusals: the per-app velocity
limit, the per-app aggregate daily cap, a transient "unavailable" deny and a
missing price quote all resolve the same way and buying Buzz fixes none of them.

What DOES reject (since `@civitai/blocks-react@0.44.0`) is a failure-shaped reply
with **no `cost`** — `cost` presence is the discriminator, since `status` is
`'failed'` for all of them. `err.code` then says how much you may assume about money — and **neither code
guarantees nothing was spent**. `'exception'` means the host had no workflow to
report (usually nothing queued, but a lost response or an in-progress idempotency
conflict also lands there, so retry with the SAME `idempotencyKey`);
`'workflow-failed'` means a workflow probably exists and **spend may already be
committed** — poll `err.snapshot.workflowId` rather than retrying blindly, after
checking it is not the `'whatif'` non-workflow sentinel (there is nothing behind
that one to poll). See civitai/civitai-app-starters#251.

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

This example does a **real server-side cancel** (gotcha #51): `cancel(workflowId)`
asks the host to STOP the workflow on the orchestrator — not just untrack it
client-side — so a running job stops spending Buzz. It then clears the card.

```tsx
const { cancel } = useBuzzWorkflow();      // @civitai/blocks-react >= 0.5.0
if (item.workflowId) cancel(item.workflowId).catch(() => {}); // best-effort
setQueue((q) => q.filter((it) => it.localId !== localId));     // clear the card
```

The host re-derives ownership from the viewer's orchestrator token, so a block
can only cancel workflows the viewer owns. `cancel` is best-effort: if the
workflow already finished it rejects, but the card is cleared regardless.

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
