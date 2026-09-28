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

`useEntitlements()` returns an `unauthenticated` flag alongside `error`. A page App Block is a public surface, so a logged-out viewer is the common path rather than an edge. Branch on `unauthenticated` before `error` or every anonymous first paint shows a retry button that cannot succeed.

🔴 `unauthenticated` is **derived from the viewer, not from a response**: `isSignedIn(useBlockContext().viewer) === false` once `BLOCK_INIT` has landed. That makes it knowable before any request fires, so an anonymous viewer costs no round trip — the hook skips the GET entirely and settles with `error === null`, because nothing failed. It stays `false` until init lands, since a pre-init viewer is *unknown* rather than absent; a block that never gets embedded therefore reaches its host-origin error and not a sign-in screen.

🔴 It is **not** "the status was 403", and a response-derived predicate cannot work here. `src/pages/api/v1/blocks/entitlements.ts` runs under `withBlockScope(…, { requiredScope: 'goods:read:self' })`, and that middleware puts a `:self` scope with an anonymous subject in its `context_binding` arm — so the anonymous refusal arrives **coded**, there is no reachable uncoded 403 on this route, and an earlier `status === 403 && code == null` predicate could never fire for the one case it existed for. Re-keying it on `context_binding` would be worse still: the same code covers a wrong `modelId` and an array-form query param, so a signed-in viewer would be told to sign in. Every 403 now surfaces on `error` with the server's own wording — including the likeliest one in practice, `insufficient_scope`, a manifest that simply omits `goods:read:self`.

`useGoodPurchase()` distinguishes its two non-refusal rejections. The 30s bound now rejects with a plain `Error` naming the timeout (a real failure a caller must handle), while an unmount rejects with `name === 'AbortError'` — the discriminator a caller uses to ignore a rejection its component no longer cares about. Both messages still carry the same-key retry advice, since the charge may have landed either way.

🔴 That classification is decided by the **abort state**, not by whether a body happened to parse, so it holds when the abort lands during the body read — the ordinary shape, since response headers arrive before the body. Swallowing that `AbortError` got both cases backwards: a 200 cut off by an unmount was reported as `malformed_success` ("the charge may have landed") to a caller told to ignore navigate-away aborts, for a purchase that had **succeeded**; and a 4xx cut off by the timeout became `purchase request failed (<status>)` with `reason` and the timeout advice lost. The one deliberate exception runs the other way: a refusal the hook had already parsed stays a `GoodPurchaseRefusal` even if an abort fires in the same tick, because `reason` is what the top-up branch needs.

`useGoodPurchase()` also validates `purchase` on a 2xx alongside `entitlement`: `GoodPurchaseResult` declares both required, so a body missing `purchase` used to resolve and then `TypeError` at `result.purchase.id`.
