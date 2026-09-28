---
'@civitai/blocks-react': minor
---

Add `useGoodPurchase` and `useEntitlements` — the app-side half of the App Blocks digital-goods rail shipped in `civitai/civitai`#5171.

`useGoodPurchase().purchase({ goodId })` buys a manifest-declared good for the viewer through the block-token-gated `POST /api/v1/blocks/goods/purchase` (scope `goods:purchase:self`), and `useEntitlements()` reads what the viewer already owns from this app through `GET /api/v1/blocks/entitlements` (scope `goods:read:self`, which is consent-exempt — a read-only app needs no purchase power and triggers no re-consent prompt).

Both are direct-fetch hooks against the validated host origin with the block bearer token, the same reviewed pattern as `useTip`. The buyer is always the token subject; no user id is ever sent from the block.

`purchase()` optionally adopts the existing top-up modal: `{ topUpOnInsufficientFunds: true }` opens `useBuzzPurchase()` on an `insufficient_funds` refusal and retries **once, with the same idempotency key**, but only if the viewer actually bought Buzz. Buying a good (Buzz out, to the app owner) and buying Buzz (fiat in, to the viewer) are opposite rails — this is the one place they meet.

Refusals reject with a `GoodPurchaseRefusal` carrying `status` and the machine-readable `reason`, so apps branch on that rather than on viewer-facing copy.
