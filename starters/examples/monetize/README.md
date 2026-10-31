# monetize: how an app earns

This example sells two manifest-declared **digital goods**, gates a premium
feature on what the viewer **owns**, and takes **tips**. It also says plainly
which money rails it can't use and why.

Read [How an app earns](https://developer.civitai.com/apps/guide/earning.md)
alongside it. Every platform claim below cites the civitai source it comes from
(`civitai/civitai`, `main` at `4949414`), as `file:line`.

## What it shows

| Concept | Where |
|---|---|
| The `goods` catalog (`good` kind), priced in Buzz | `block.manifest.json` |
| `useGoodPurchase`: in-block confirm, `expectedPriceBuzz`, one idempotency key per purchase, top-up on `insufficient_funds`, a `switch (reason)` with a `default` | `src/BuyButton.tsx` |
| `useEntitlements` gating a premium feature in the safe order: anonymous → loading → error → owned | `src/App.tsx` (`packState`) |
| `TipButton` (the packaged control) and `useTip` (a custom amount, done by hand) | `src/TipJar.tsx` |
| `useTipAllowance`, and re-reading it through the **latest** `refetch` after a tip | `src/TipJar.tsx` |
| Scopes `goods:read:self`, `goods:purchase:self`, `social:tip:self`, with `scopeJustifications` | `block.manifest.json` |
| A harness stand-in for the four money REST routes | `src/devMoneyApi.ts`, `src/Harness.tsx` |

## The rails, and what a third-party app can use today

| Rail | Usable by this app? | Who pays → who gets | Shown here |
|---|---|---|---|
| **Digital goods** | **Yes**, for an approved app | viewer's Buzz → app owner gets `floor(price × 0.7)` immediately, platform keeps the rest | yes |
| **Tips** | **Yes** | viewer's Buzz → the person tipped. The app gets nothing | yes |
| **Per-generation author fee** | Automatic, nothing to call | viewer's Buzz → app owner, settled daily | explained only |
| **Buzz bought inside the block** | Recorded, **never paid out** | card payment → platform; the app's share is only *accrued* | explained only |

### 1. Digital goods: live

- **The split.** The owner's share is `Math.floor(priceBuzz * 0.7)`
  (`src/shared/constants/block-goods.constants.ts:23`, `:39`). The style pack is
  100 → 70 and the badge is 20 → 14. Price in multiples of 10 if you want an
  exact 70/30.
- **The scopes.** The purchase route needs `goods:purchase:self`
  (`src/pages/api/v1/blocks/goods/purchase.ts:315`). That scope is
  **sensitive** (`src/shared/constants/block-scope.constants.ts:677`), so the
  manifest must justify it, and it is **consent-gated**. The entitlements read
  needs `goods:read:self` (`src/pages/api/v1/blocks/entitlements.ts:89`), which
  is **consent-exempt** (`src/server/services/blocks/scope-grant.service.ts:1466`,
  `:1489`). The read works on first load. The first purchase asks for consent.
- **Approved apps only.** The good and its price come from the latest
  **approved** manifest (`purchase.ts:136`,
  `src/server/services/blocks/block-goods.service.ts:226`). An app that hasn't
  been approved gets a `404` "not available".
- **The owner can't buy their own goods.** That attempt is refused with
  `self_purchase` (`block-goods.service.ts:604`). To test a real purchase, use a
  second account. This matters for `dev:live`, because its token is minted for
  *you*, the owner.
- **One per viewer.** A good is a permanent entitlement. Buying it again is
  refused with `already_owned` (`block-goods.service.ts:623`).
- **What the block sees after a purchase.** The `200` carries the granted
  entitlement. The block then calls `useEntitlements().refetch()`. **No new
  token is needed**: entitlements are looked up by viewer + calling app
  (`block-goods.service.ts:1474`), not carried on the token. A token *is*
  re-minted on the first purchase, but that's the consent grant: the host
  re-mints and pushes `TOKEN_REFRESH` (`src/components/AppBlocks/IframeHost.tsx:1999`,
  `:1705`), and the hook retries the same purchase with the same key.
- **`app_unlock` is not shown, on purpose.** The canonical schema's `kind`
  description says the access gate "is a later change". An unlock is recorded
  like any other good, and **no viewer is kept out**. This example doesn't sell
  one, because it would charge for admission the platform doesn't enforce. When
  the gate exists, it's the host that refuses entry. The block-side read is
  `owns('<id>')`, exactly as for the style pack. Unlocks have their own rules
  (≤ 5000 Buzz, `block-goods.constants.ts:117`; one per manifest; a required
  `justification`).

The premium feature is gated in this order, because `owns()` is `false` both
while loading **and** after a failed read:

```tsx
import { useEntitlements } from '@civitai/blocks-react';

function PackStatus() {
  const { unauthenticated, loading, entitlements, error, owns } = useEntitlements();
  if (unauthenticated) return <span>Sign in to unlock</span>;
  if (loading && entitlements === null) return <span>Checking your purchases…</span>;
  if (error) return <span>Couldn't check your purchases</span>; // NOT "locked"
  return owns('style-pack') ? <span>Unlocked</span> : <span>Locked</span>;
}
```

### 2. Tips: live, and not income for the app

`POST /api/v1/blocks/tip` and `GET /api/v1/blocks/tip-allowance` both need
`social:tip:self` (`src/pages/api/v1/blocks/tip.ts:397`, `tip-allowance.ts:91`).
That scope is sensitive and consent-gated. The tip moves **yellow** Buzz from
the viewer to `toUserId` (`tip.ts:224`). Limits: at most 5,000 per tip and
25,000 per day (`src/server/utils/block-tip-rate-limit.ts:89`, `:94`). A
self-tip is refused (`tip.ts:140`).

A model slot doesn't tell the block who created the model. So the recipient is
the `tip_recipient_user_id` **publisher setting**, which the model owner sets
when they install the block. If it's empty, the tip jar hides.

🔴 **Re-read the allowance through the LATEST `refetch`.** `useTipAllowance`'s
`refetch` sends the token of the render that created it. The first tip is a
consent round-trip: it starts on a token without `social:tip:self` and lands on
the re-minted one. An `onTipped` that holds the pre-grant `refetch` (the shape
`TipButton`'s own `@example` shows) gets `403` and leaves the allowance stale.
In this example's harness, the post-tip read went `403` until `TipJar.tsx`
routed it through a ref. With the ref, the allowance moves 25,000 → 24,950 →
24,750.

### 3. Per-generation author fee: automatic, nothing to call

Every generation an app submits can carry a viewer-paid fee to the app owner:
`max(flat, pct × base)`. The defaults are 1 Buzz / 5%
(`src/server/services/blocks/author-fee.ts:119`, `:122`), and `chat-completion`
is set to `0/0` (`:271`). The submit path quotes it
(`src/server/routers/blocks.router.ts:6339`). The fee is folded into
`estimate()`'s total with no line item of its own, and it counts against the
per-generation budget.

It runs behind a platform switch (`src/server/services/app-blocks-flag.ts:878`).
The source records it charging since 2026-09-25 (`:873`) and says the current
value lives in the platform's flag service, not in code. An app can't
configure it, so there's nothing to show here. This block runs no generations.
For one that does, see [`buzz-workflow`](../buzz-workflow).

### 4. Buzz bought inside the block: accrued, not paid

When a viewer tops up through the host's modal from inside a block, the host
attaches the install as attribution (`IframeHost.tsx:2119`, `:2221`). This
example reaches that modal through `topUpOnInsufficientFunds`. The platform
records your share. **No code path pays it out.** The owner's revenue panel
says "automated payouts are not yet enabled"
(`src/components/AppBlocks/RevenuePanel.tsx:228`). Don't price anything
against it.

## Run it

```bash
npm install           # inside this monorepo: pnpm install, at the root
npm run dev:harness   # → http://localhost:5190
```

**These money hooks don't use the bridge.** `useGoodPurchase`,
`useEntitlements`, `useTip` and `useTipAllowance` call `fetch` on
`<host>/api/v1/blocks/…` directly. The SDK mock host only answers the bridge.
So under the mock host, `src/devMoneyApi.ts` answers those four routes with the
server's status codes, bodies and `reason`s, each one cited. It's never part of
a build: the production bundle contains none of it.

It models the scope gate the way the real mint does. A route is refused with
`403 insufficient_scope` unless the scope is **declared** and on the token.
Delete a scope from the manifest and its feature is refused.

It does **not** model rate limits, the daily purchase ceiling, outage `503`s,
`charge_unknown`, the blue/yellow Buzz pools (it keeps one balance), or pinned
installs.

**Two ways the mock host differs from production:**

- Its consent grant gives the token any known scope, declared or not. The
  stand-in applies the manifest itself.
- It always sends empty `settings`. `src/Harness.tsx` fills in the tip recipient
  for it.

Knobs, on top of `?viewer=anon` and `?theme=light`:

| Knob | Effect |
|---|---|
| `?wallet=N` | Starting Buzz. Default 50: enough for the badge but not the pack, so buying the pack shows the top-up. The mock "buys" 1000 |
| `?repriced=style-pack` | Server price is 10 higher → `price_changed` |
| `?owner=self` | `self_purchase` |
| `?recipient=self` | Self-tip refusal |
| `?tipRecipient=none` | Tip jar hidden |

`npm run dev:live` runs the same block against the real API through the
`/api` proxy (see [the examples README](../README.md#against-the-real-backend-devlive)).
⚠️ **A tip there moves your own real Buzz to a real person**, and your token's
own purchases are refused with `self_purchase` (or `404` before approval). Test
a purchase from a second account on the live site.
