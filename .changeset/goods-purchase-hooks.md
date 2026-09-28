---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

Add `useGoodPurchase` and `useEntitlements` — the app-side half of the App Blocks digital-goods rail shipped in `civitai/civitai`#5171.

`useGoodPurchase().purchase({ goodId })` buys a manifest-declared good for the viewer through the block-token-gated `POST /api/v1/blocks/goods/purchase` (scope `goods:purchase:self`), and `useEntitlements()` reads what the viewer already owns from this app through `GET /api/v1/blocks/entitlements` (scope `goods:read:self`, which is consent-exempt — a read-only app needs no purchase power and triggers no re-consent prompt).

Both are direct-fetch hooks against the validated host origin with the block bearer token, the same reviewed pattern as `useTip`. The buyer is always the token subject; no user id is ever sent from the block.

`purchase()` optionally adopts the existing top-up modal: `{ topUpOnInsufficientFunds: true }` opens `useBuzzPurchase()` on an `insufficient_funds` refusal and retries **once, with the same idempotency key**, but only if the viewer actually bought Buzz. Buying a good (Buzz out, to the app owner) and buying Buzz (fiat in, to the viewer) are opposite rails — this is the one place they meet.

Refusals reject with a `GoodPurchaseRefusal` carrying `status` and, where the server sends one, a machine-readable `reason` — so apps branch on that rather than on viewer-facing copy. Note `reason` is `undefined` for the endpoint's own refusals (the 404, the 429, the daily-cap 400 and every idempotency refusal); only service-level ones populate it, so always fall back to `status` and `message`.

`@civitai/app-sdk` gains the two block scopes these hooks require — `goods:read:self` and `goods:purchase:self` — in `BLOCK_SCOPES` and in the vendored canonical schema. They were live on the server and in the published canonical schema while absent here, so `defineBlock` rejected them and no app scaffolded from this repo could declare either one. Without this the hooks above are unreachable.

`@civitai/app-sdk` also gains `BlockManifestGood` and a `goods?` property on `BlockManifestV1`. The canonical schema has carried `goods` for a while, but the TYPE did not — so `defineBlock`'s documented inline-literal form rejected a goods declaration with TS2353 while Ajv accepted the same manifest from a JSON file. A new guard pins every canonical top-level property against the interface's keys, so the schema cannot grow a property the type lacks again.

`useEntitlements()` returns an `unauthenticated` flag alongside `error`. A page App Block is a public surface, and a logged-out viewer's block token is anonymous — the server refuses both goods scopes for one, which is an `error` that no retry can clear. Branch on `unauthenticated` before `error` or every anonymous first paint shows a retry button that cannot succeed.
