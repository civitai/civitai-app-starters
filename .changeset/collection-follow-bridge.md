---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add the collection-follow host bridge (`SET_COLLECTION_FOLLOW` → `COLLECTION_FOLLOW_RESULT`), the `useCollectionFollow()` hook, and two shared `/ui` controls: `FollowButton` and `TipButton`.

The host half already merged in `civitai/civitai#4666` (handlers in both real hosts plus the `hostHandlerParity` inventory entry, which explicitly permits a forward-looking entry ahead of the published SDK union). This is the SDK half that energises it: until it publishes, the bridge is inert.

## What the bridge is, and why it is a TIGHTENING

A block could already follow a collection over HTTP — `POST /api/v1/blocks/collections/[id]/follow`, gated on the block scope `collections:write:self`. That endpoint stays live and is untouched.

🔴 **The scope was never a consent step.** `collections:write:self` is listed in `CONSENT_EXEMPT_SCOPES` server-side (*"server visibility/ownership is the gate, not a per-scope consent prompt"*), `partitionByConsent` puts it straight into `signable`, and no grant row is ever recorded. So on HTTP a block that merely *declared* the scope could follow arbitrary collections for the viewer with **zero prompts**, at install time or ever. The bridge converts a zero-prompt path into a **one-prompt-per-action** path.

What it costs, precisely, is the manifest `scopes` declaration — the ex-ante reviewability signal a moderator reads before install and a viewer inspects afterwards. An app on the bridge declares no write scope, so its permissions panel can read empty while it writes to the viewer's collections. The real trade is **"reviewable before install" → "consented at the moment of action"**, and it is worth stating plainly rather than as a security win.

The replacement gate is the platform's other consent idiom (the same one `PUBLISH_GENERATION_OUTPUTS` uses): a **host-chrome confirm**, which a sandboxed cross-origin block can neither fake nor restyle. It names the collection **the host itself resolved from `collectionId`** — there is deliberately no `name` field on the wire, because a block-supplied one would let a card reading "Follow ⭐ Cute Cats" post a different id with the host's own chrome vouching for it.

## `useCollectionFollow()`

`{ setFollow, pending, error }`. No block scope and no token on the wire: the host calls the session-authed `collection.follow` / `collection.unfollow` procedures, whose handlers pass `ctx.user.id` as both actor and target, so `collectionId` is the only thing a block influences.

🔴 **`SET_COLLECTION_FOLLOW` is bucketed `'human'`, not `'protocol'`**, so it carries the 10-minute consent bound rather than the ~30s default. The wrong bucket here is not merely slow — the request would reject **while the dialog is still open**, so a viewer who then clicked Follow would get a followed collection and a block showing a failure, with nothing to reconcile them. That is `civitai/civitai#4158`'s shape in the follow axis. The `satisfies Record<BlockToParentMessageType, …>` totality gate in `internal/requestTimeouts.ts` forced the decision at `tsc` time; the behavioural half of `humanGatedRequestTimeouts.test.tsx` drives it past 120s and settles it on a late reply.

🔴 **The error channel is NOT a discriminated enum**, unlike `WILDCARD_PACK_RESULT`'s. It carries either one of six closed host refusal codes OR a free-text server message the host forwards verbatim (`err.message` from the collection service — e.g. a `FORBIDDEN` on a private collection). Three consequences, all load-bearing:

- The transport validator gates `error` on **shape only**. A membership check would drop every server failure, and a dropped reply on a REQUEST-style message hangs the block to its 10-minute bound — turning a legible "you may not follow that" into a wedged button.
- "Is this a code?" is therefore a runtime **membership** question, exported as `isCollectionFollowErrorCode` / `COLLECTION_FOLLOW_ERROR_CODES`. A `switch` over the union type would silently treat prose as unmatched while a typo'd literal compiled fine, and a `.includes()` implementation would misclassify *"the request was declined by the server"* as the `declined` code.
- `CollectionFollowError.code` is `undefined` for a server error. That is a **positive** signal that `.message` came from the service and is meant to be shown — not "unknown refusal".

Two codes are not failures to render, and they are the reason this is a shared hook rather than eleven hand-rolled ones:

- **`declined`** — the viewer dismissed the confirm, so **no write occurred**. It is trustworthy in the direction that matters: the host takes its consent latch synchronously before the write, so it can never be reported for a follow that landed. Surfaced as `err.declined`.
- **`sign-in-required`** — no session, so the viewer's next step is signing in, not retrying. Surfaced as `err.signInRequired`.

🔴 **`collection-unavailable` deliberately means four different things** — does not exist, not visible to this viewer, the lookup failed, *and* the block exhausted its per-instance budget of 20 distinct collection ids. A distinct "not found" would let a block enumerate private collection ids by asking the host to name them; a distinct "rate limited" would hand back exactly the bit the cap withholds. Do not branch on it for anything but "we cannot act on this id".

`error: ''` is a valid reply and is mapped to a code rather than thrown as a blank message — `||`, not `??`, and the opposite choice from `useWildcardPack` for the opposite reason.

## `FollowButton`

`collectionId` + `followed` (+ `onChange`, `collectionName`, `disabled`, `size`, `variant`). Flips optimistically, adopts the **host's echo** rather than its own guess, and reverts on failure. `declined` reverts **silently**; `sign-in-required` routes into `REQUEST_SIGN_IN`; everything else reverts with a `role="alert"` note — `aria-pressed` reverting is indistinguishable from never having pressed, so without the alert a screen-reader user is told nothing at all about the failure.

The `followed` prop stays the source of truth. While a write settles the control asserts its own value, and on success it **holds the echo until `followed` agrees**, so it never blinks back to a stale server value while the parent catches up — including when `onChange` is omitted entirely.

## `TipButton`

`toUserId` + `amount` + `noun` (+ `entityType`/`entityId`, `tipped`, `remaining`, `disabledReason`, `onTipped`).

🔴 **Its confirm is the component's, NOT host chrome** — say that rather than implying platform mediation. `useTip` posts to the block-token-gated tip endpoint directly, so unlike the follow bridge nothing outside the iframe asks the viewer anything and a one-press money spend is reachable by construction. The two-step handshake is the only thing between a stray tap and a transfer.

🔴 **It mints one idempotency key per logical tip and reuses it on retry.** This is the property a hand-rolled tip button most reliably misses: `useTip` mints a *fresh* key per call when none is passed, so retrying after a response that was merely **lost** sends a second transfer — and from inside the block a lost response is indistinguishable from a rejection, which is exactly where the retry path lives. Changing the target or amount correctly mints a new key. The key is not rotated after a success, which is safe **only** because a settled control is terminal; a test pins that terminality, so making the settled state re-armable fails rather than silently double-charging.

`remaining` is a **prop, not an internal `useTipAllowance()`** — this control is rendered per card, so fetching inside it would fan one screen out into N identical HTTP reads. Hold one allowance read in the view and pass it down.

## Dev hosts

- `createMockHost` gains `collectionFollowError` (a code *or* free text) and `collectionFollows` (seeded, mutable, merged by `setScenario`), and **mirrors the real host's payload gate** — a numeric-string id is refused as `invalid-request`, not coerced. Without that the mock would be more permissive than production and a block bug would work in `dev:mock` and fail live.
  🔴 What it structurally cannot prove: the consent dialog is host chrome, so the mock settles immediately where the real host waits on a click. Nothing exercises the *timing* of a confirm — only the outcomes.
- `createLiveHost` **refuses** with `collection-unavailable`, and the refusal is the point. That harness holds a block token and could call the legacy scoped HTTP endpoint — a path with no consent confirm — so routing to it would let dev prove out a flow production does not have, and a block would ship having never once handled `declined`. `sign-in-required` was rejected as the code because it would send a block into a `REQUEST_SIGN_IN` loop against a harness that has no sign-in.

## Verification

Suite 1355 → 1413, typecheck and build clean across all five packages, README snippet gate 45/45 (positive-controlled: a deliberate type error in the new snippet fails it).

**20 mutants, 20 killed**, each by the test whose name states the property, none via an import failure, with a positive control proving the harness can go red: the timeout bucket, the hook's own `timeoutMs` opt-out (the reachability check — the ledger pin alone would pass for a request never wired), `??`-for-`||`, both refusal flags, a `.includes()` code check, an enum-only validator, the id-sign check, an unmapped `payloadValidatorFor` case, the echo-vs-guess adoption, the silent-decline branch, the sign-in routing, the optimistic flip, the allowance boundary (`>` vs `>=`), the idempotency key's amount component, a one-click tip, the mock's payload gate, a live host fabricating success, and dropping the message from the SDK union.

**Not verified, and not claimed:** no end-to-end run against a real host. The blocks in this repo cannot reach one, and `civitai#4666`'s own browser tier mocks `trpc.useUtils()`, so no real `collection.getById` response has ever been observed on either side of this bridge. Failure modes degrade to refusals by construction, so the failure direction is safe, but the happy path's rendered content is unproven against production.

## Pairing

`@civitai/blocks-react@0.48` needs `@civitai/app-sdk@>=0.38` — the hook imports `BlockCollectionFollowErrorCode` / `BlockCollectionFollowResult` from it. 🔴 The `peerDependencies` floor is deliberately NOT tightened: #206 widened it to `>=0.29.0 <1.0.0` precisely so an SDK minor stops forcing a major on consumers, and reversing that here would be a worse trade than the warning it buys. The consequence, stated rather than hidden: **npm will not warn about an under-paired install** — it fails at `tsc` with `Cannot find name 'BlockCollectionFollowErrorCode'`. The compat table in the README carries the pairing.

Adopting these in the first-party blocks is deliberately not part of this change — each needs the published version first.
