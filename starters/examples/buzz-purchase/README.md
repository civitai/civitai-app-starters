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
`status: 'failed'` and an `error` string — the transport resolves the reply, it
does **not** throw on a failed snapshot (a throw happens only on transport-level
failures: timeout, malformed reply). So check the snapshot:

```tsx
const snap = await submit(body);
if (snap.status === 'failed' && /insufficient|budget|not enough/i.test(snap.error ?? '')) {
  const { purchased } = await openPurchaseModal(shortfall);
  if (purchased) await submit(body);   // retry; the host re-mints the token with the new balance
}
```

The exact error wording isn't a stable contract — match loosely and fall back to
showing the raw message.

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
