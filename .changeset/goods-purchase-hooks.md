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

`@civitai/app-sdk` also gains `BlockManifestGood` and a `goods?` property on `BlockManifestV1`. The canonical schema has carried `goods` for a while, but the TYPE did not — so `defineBlock`'s documented inline-literal form rejected a goods declaration with TS2353 while Ajv accepted the same manifest from a JSON file. Two new guards pin the canonical's properties against the interfaces' keys — one for the top level, one for the NESTED object shapes (`goods[]`, `iframe`, `page`, `targets[]`) — so neither level can grow a property the types lack again. The nested half is not a nicety: adding `goods.items.properties.badgeUrl` to the schema passed a fully green suite under the top-level guard alone, which is the identical TS2353 failure one level down.

`useEntitlements()` returns an `unauthenticated` flag alongside `error`. A page App Block is a public surface, and a logged-out viewer's block token is anonymous — the endpoint refuses it, which is an `error` that no retry can clear. Branch on `unauthenticated` before `error` or every anonymous first paint shows a retry button that cannot succeed.

🔴 `unauthenticated` is **not** "the status was 403". A 403 on that route has seven producers and only the two the endpoint itself emits mean "not signed in"; the five from `withBlockScope` (`instance_revoked`, `consent_revoked`, `app_not_approved`, `insufficient_scope`, `context_binding`) all carry a `code` field, which the middleware guarantees on every 403 it sends. The flag is therefore set on `status === 403 && code == null`, and every coded 403 surfaces on `error` with the server's own wording instead. Keying on the status alone sent a signed-in viewer whose manifest simply omits `goods:read:self` — the likeliest 403 in practice — to a sign-in screen, and buried the one message naming the real fix.

`useGoodPurchase()` distinguishes its two non-refusal rejections. The 30s bound now rejects with a plain `Error` naming the timeout (a real failure a caller must handle), while an unmount rejects with `name === 'AbortError'` — the discriminator a caller uses to ignore a rejection its component no longer cares about. Both messages still carry the same-key retry advice, since the charge may have landed either way. It also validates `purchase` on a 2xx alongside `entitlement`: `GoodPurchaseResult` declares both required, so a body missing `purchase` used to resolve and then `TypeError` at `result.purchase.id`.
