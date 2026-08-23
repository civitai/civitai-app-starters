# buzz-purchase — top up Buzz

`useBuzzPurchase()` — open the Civitai Buzz purchase modal and retry a
generation the viewer couldn't afford.

## What it shows

| Concept | Where |
|---|---|
| `useBuzzPurchase().openPurchaseModal()` | `src/App.tsx` |
| Detecting an insufficient-budget submit | `tryGenerate()` |
| Top-up → retry | `topUpAndRetry()` |

## The hook

```tsx
const { openPurchaseModal } = useBuzzPurchase();

const { purchased, newBalance } = await openPurchaseModal(suggestedAmount);
// resolves when the user closes the modal:
//   purchased: true  → balance increased (newBalance if the host reports it)
//   purchased: false → user dismissed without buying
```

## The insufficient-budget path

This is the canonical use. The host enforces `cost ≤ budget` before forwarding a
generation. When it refuses, the SDK surfaces it as a **resolved** snapshot with
`status: 'failed'`, an `error` string, and the **`cost` it declined to charge** —
a workflow *outcome*, not an error. So check the snapshot:

```tsx
const snap = await submit(body);
if (snap.status === 'failed' && /insufficient|budget|not enough/i.test(snap.error ?? '')) {
  const { purchased } = await openPurchaseModal(shortfall);
  if (purchased) await submit(body);   // retry; the host re-mints the token with the new balance
}
```

The exact error wording isn't a stable contract — match loosely. 🔴 **But do not
render `snap.error` to a viewer**: it is server-authored and unsanitised (raw
upstream text, database constraint names among it, can reach it). Log it and show
copy your app owns, as `src/App.tsx` does.

🔴 **Not every resolved `'failed'` is about the wallet.** Only the per-call
`buzzBudget` gate and the per-user daily Buzz cap are affordability. The per-app
**velocity** limit, the per-app **aggregate daily** cap, a fail-closed
**"temporarily unavailable"** deny and a **missing price quote** are priced,
resolving outcomes too — and buying Buzz fixes none of them. That is what the
`isInsufficientFunds` match is for: it keeps the top-up CTA off the others.

🔴 **And failure-shaped replies with no `cost` throw.** Since
`@civitai/blocks-react@0.44.0` `submit()` **rejects** those with a
`WorkflowSubmitError` (civitai/civitai-app-starters#251), and **`err.code` decides
what you may say about money**:

- `'exception'` — the host built the reply itself (from a `catch`, or a
  short-circuit like the moderator-review nack). It means **the host had no
  workflow to report**, which is *usually* "nothing was queued, nothing was
  charged" — but a lost response, an in-progress idempotency conflict or a
  transient 5xx also land here, and those may have created and charged a
  workflow. If you retry THIS attempt, reuse the **same** `idempotencyKey` so the
  retry cannot double-reserve — and don't promise a refund.
  🔴 **`src/App.tsx` does not demonstrate that**, deliberately: it performs no
  retry on this arm, and its only retry — after a top-up — is a NEW attempt under
  preconditions the viewer just paid to change, not a repeat of the old one.
  Reusing a key there would ask the server to collapse the retry onto the refusal
  it already returned. Pass a stable key when *your* app retries the same
  attempt; see `SubmitWorkflowOptions.idempotencyKey`.
- `'workflow-failed'` — the id was not the host's sentinel, so a workflow
  probably exists. **Buzz may already be committed** (server-side, any resolved
  submit keeps its reservation regardless of snapshot status). Do not tell the
  viewer it was free, and do not auto-retry — that mints a fresh idempotency key
  and reserves a second time. Poll `err.snapshot.workflowId` instead, after
  checking it is not the `'whatif'` non-workflow sentinel.
- **Anything that is not a `WorkflowSubmitError`** — a transport failure, most
  likely the 120s timeout. A timed-out submit may well have been queued and
  charged, so give it the most cautious copy of all.

Keep all three paths. See `src/App.tsx`, which handles the priced refusal on the
resolved branch and branches on `err.code` in its `catch`.

> After a purchase the host pushes a fresh `TOKEN_REFRESH` with the updated
> `buzzBudget`, so the retry sees the new headroom. The harness simulates this.

## Run it

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5185
```

The harness starts with a 50-Buzz budget (below the 120-Buzz cost) so the first
Generate trips the insufficient path; the simulated purchase lifts the budget and
the retry succeeds. See the [root README](../../../README.md) for submit →
review → deploy.
