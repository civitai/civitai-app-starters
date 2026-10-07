# buzz-purchase — top up Buzz

`useBuzzPurchase()` — open the Civitai Buzz purchase modal when the viewer's
wallet can't cover a generation, then retry it.

## What it shows

| Concept | Where |
|---|---|
| Pricing with `estimate()` — never a hard-coded cost | `src/App.tsx` |
| The two limits: the wallet (`useBuzzBalance`) vs the per-generation budget (`token.buzzBudget`) | `explainBlocker()` |
| `useBuzzPurchase().openPurchaseModal()` → retry, with its guards | `topUpAndRetry()` |
| `buzz:read:self` + `buzz_budget_per_gen` | `block.manifest.json` |

## Two limits, and a purchase moves only one

| Limit | Where the block reads it | Raised by buying Buzz? |
|---|---|---|
| the viewer's **wallet** | `useBuzzBalance()` (needs `buzz:read:self`) | **yes** |
| the **per-generation budget** | `useBlockContext().token.buzzBudget` | **no** |

The budget is a safety ceiling the host signs into the block token from the
install's `buzz_budget_per_gen` publisher setting (capped at 1000; with no such
setting the platform default is far below a typical generation — which is why
this manifest now declares one). A purchase does not touch it: the host's reply
to `OPEN_BUZZ_PURCHASE` is `{ purchased }` and nothing else — no new token, no
new budget — and the budget is re-derived from the install settings on every
mint. So a generation priced above the budget is refused whatever the wallet
holds. **Never offer a top-up for it**; tell the viewer the limit is the
installer's to change.

## The flow

1. **Price it.** `estimate(body)` returns the cost the server will charge (an
   author fee included). The button stays disabled until there is a price.
2. **Check the budget, then the wallet** — `explainBlocker(price)`, from the
   numbers, never from a refusal's wording:
   - `price > token.buzzBudget` → the limit message, no top-up;
   - `wallet < price` → "You're N Buzz short", with **Buy Buzz & retry**;
   - otherwise → submit.

   The budget is only on the token once the viewer has granted the spend scope,
   so the first generation goes straight to `submit()` (which asks for that
   consent).
3. **Submit.** A failure comes back two ways, and only ONE can lead to a top-up
   (`src/outcome.ts` holds the rule):
   - **resolved**, `status: 'failed'` — **never a top-up.** With the `'failed'`
     placeholder id a spend cap or limit refused it before the wallet was even
     looked at, so a retry after buying Buzz hits the same cap; the example says
     it couldn't run and nothing was charged. With a **real** workflow id a run
     came back failed and may have spent; the example says so and never
     retries. (The complete list is in `useBuzzWorkflow`'s `submit` docs.)
   - **rejected** with `WorkflowSubmitError` code `'exception'` — the host had no
     workflow to report, which is how a wallet the orchestrator could not debit
     reaches the block. This is the only branch that re-reads the balance and,
     through step 2, offers a top-up when the viewer's spendable Buzz is below
     the price.

   `'workflow-failed'` and transport errors are not affordability at all: Buzz
   may already be committed, so the example says so and does not retry.
4. **Top up and retry.** `openPurchaseModal(shortfall)` resolves when the modal
   closes. On `purchased: true` it re-reads the balance and retries.

🔴 **Do not render `snap.error` or `err.message`.** The first is server-authored
and unsanitised; the second is developer-facing and not a contract. Log them,
and show copy the app owns.

🔴 **The guarding around the retry is the pattern to copy.** The modal waits on a
human, so the retry is a paid submit fired at a moment you do not control:

1. guard re-entry with a **ref** — two clicks in one frame both read stale state;
2. catch the rejection — an abandoned modal eventually times out;
3. before auto-spending, check the viewer is still there with
   `document.visibilityState` — not elapsed time (3-D Secure legitimately takes
   minutes), and not `document.hasFocus()` (focus stays in the host document).

🔴 **No `idempotencyKey` on the retry, deliberately.** It is a NEW attempt under
preconditions the viewer just paid to change, not a repeat of the refused one.
Reuse a key only when your app retries the SAME attempt — after an
`'exception'` or a transport failure — so a lost response cannot reserve twice;
see `SubmitWorkflowOptions.idempotencyKey`.

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5185
```

`src/Harness.tsx` sets the SDK mock host up with a 120-Buzz generation and a
50-Buzz wallet, with the spend scope already granted (`consentGranted`): the
first Generate is stopped by the step-2 wallet check, which offers a 70-Buzz
top-up; the mock purchase refills the wallet and the retry lands.
`?costPerGen=600` prices the generation above the mock's 200-Buzz
per-generation budget instead, and no top-up is offered.

Two things the mock does differently from production, so don't read the harness
as the host's exact shapes: it reports a short wallet as a *resolved* priced
refusal (production rejects with `'exception'`), and its balance read
(`useBuzzBalance`) is fixed at the starting wallet even after a purchase. Because
of the first, a submit that reaches the mock with a short wallet shows the
"couldn't run right now" message, not a top-up — this example (correctly, for
production) never treats a resolved refusal as a top-up cue. That is why the
harness pre-grants consent: with the budget on the token, the wallet check in
step 2 catches the shortfall before anything is submitted.

`npm run dev:live` runs against the real backend, but the live host refuses
`OPEN_BUZZ_PURCHASE` (it answers `purchased: false`) — test the purchase here.
See [the examples README](../README.md#against-the-real-backend-devlive) and the
[root README](../../../README.md) for submit → review → deploy.
