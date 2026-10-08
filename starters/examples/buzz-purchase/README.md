# buzz-purchase — top up Buzz

`useBuzzPurchase()` — open the Civitai Buzz purchase modal when the viewer's
wallet can't cover a generation, then retry it.

## What it shows

| Concept | Where |
|---|---|
| Asking for consent BEFORE pricing, and every way that request can end | `src/consent.ts` |
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

0. **Get consent.** Pricing needs the spend scope: the host refuses an
   estimate from a token without `ai:write:budgeted`, and `estimate()` never
   asks for consent itself (it runs on mount, with no click behind it). So
   while the token lacks the scope the example shows an **Allow generations**
   step and prices nothing. **Allow** calls `requestConsent({ scopes })` from
   `useRequestConsent()`, which is fire-and-forget; `src/consent.ts` decides
   what the step shows for each way it can end:
   - **granted** — the host re-mints the token with the scope (and
     `token.buzzBudget`); the step goes away and step 1 runs;
   - **unavailable** — the host pushes `CONSENT_UNAVAILABLE`
     (`useConsentUnavailable()`): the scope can never be granted here, so the
     example says so and stops offering Allow;
   - **dismissed** — nothing arrives at all, so Allow stays enabled, with
     "Waiting for permission. If the dialog closed without allowing, press
     Allow again." (the same text covers the moment before a granted token
     arrives).

   A signed-out viewer gets no consent-gated scope, so they are asked to sign
   in instead. Without this step, a viewer who hasn't consented sees no price
   and a Generate button that never enables.
1. **Price it.** `estimate(body)` returns the cost the server will charge (an
   author fee included). The button stays disabled until there is a price.
2. **Check the budget, then the wallet** — `explainBlocker(price)`, from the
   numbers, never from a refusal's wording:
   - `price > token.buzzBudget` → the limit message, no top-up;
   - `wallet < price` → "You're N Buzz short", with **Buy Buzz & retry**;
   - otherwise → submit.

   Consent came first, so the budget is always on the token by now.
3. **Submit.** A failure comes back two ways, and only ONE can lead to a top-up
   (`src/outcome.ts` holds the rule):
   - **resolved**, `status: 'failed'` — **never a top-up.** With the `'failed'`
     placeholder id a spend cap or limit refused it before the wallet was even
     looked at, so a retry after buying Buzz hits the same cap. If the price is
     above the per-generation budget (read from the token when the reply
     arrives) the example shows the limit message; otherwise it says it
     couldn't run and nothing was charged. With a **real** workflow id a run
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

`?consent=0` starts WITHOUT the spend scope, at the Allow generations step;
Allow grants it, and the price and Generate follow. `?consent=ungrantable`
starts without it in a host that can never grant it, so Allow ends in the
"isn't available" message. (The mock prices a generation even without the
scope, which the real host refuses; the example never asks it to.)

A submit that reaches the mock with a short wallet is rejected with
`'exception'`, as in production. The app then re-reads the wallet and offers a
top-up only if that read shows the shortfall. `?balance=N` sets the starting
wallet (default 50). `?insufficient=1&costPerGen=40` forces that rejection while
the wallet still reads 50: the re-read shows no shortfall, so the app says
"Could not start the generation" — what production shows when the balance read
says there is enough and the submit fails anyway.

One thing the mock does differently from production, so don't read the harness
as the host's exact behaviour: its balance read (`useBuzzBalance`) is fixed at
the starting wallet. It does not go down after a generation or up after a
purchase. The mock keeps that read separate from the balance it checks a submit
against, and `src/Harness.tsx` sets both to the same starting number.

`npm run dev:live` runs against the real backend, but the live host refuses
`OPEN_BUZZ_PURCHASE` (it answers `purchased: false`) — test the purchase here.
See [the examples README](../README.md#against-the-real-backend-devlive) and the
[root README](../../../README.md) for submit → review → deploy.
