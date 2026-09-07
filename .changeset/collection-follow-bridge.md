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
- `CollectionFollowError.code === undefined` is **not on its own** a server message worth showing — a transport timeout lands there too, with an SDK-internal `.message`. Check `.timedOut` first; `code === undefined && !timedOut` is the renderable branch. (This bullet asserted the opposite until an audit caught it — the correction is below.)

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

## What an adversarial audit changed (round 1)

The audit found **no 🔴 and five 🟡**, and four of the five were a CLAIM that was narrower or wider than the code under it — the same shape that made the host-side PR wrong. Recorded rather than quietly fixed:

- 🔴 **`FollowButton` adopted a reply about the WRONG COLLECTION.** One mounted instance whose `collectionId` prop changed mid-flight (a rail showing "the currently selected collection", an unkeyed recycled row) adopted the OLD collection's reply as the new one's state and reported it through `onChange` — so the app recorded a follow the viewer never made, on an account-write control. Now correlated on the host's ECHOED `collectionId`, which `isValidCollectionFollowResult` already pinned to a positive integer *for exactly this* and which no consumer read.
- 🔴 **The guard that was supposed to cover it did not exist.** The control carried an attempt COUNTER whose comment claimed to close "a settle arriving after the parent moved `followed`" — but it was incremented only inside `toggle()`, so it could not observe the parent at all. **Deleting all three of its lines left the file's suite fully green**, which is how the false claim survived review. It is replaced by the correlation guard, which the suite pins: removing the correlation mechanism fails the cases named for it. 🔴 **No count is quoted here on purpose** — an earlier revision said "four", audit round 2 measured three and corrected it, and audit round 3 measured four again because round 2's *own* new test had changed the answer. A number nothing asserts on drifts every time the tests move; the property is what is stable, so re-derive the count if you want it rather than reading it here.
- 🔴 **`TipButton` could swallow a transfer that LANDED.** If the viewer cancelled, or the parent flipped `tipped`, while the POST was in flight, the success path was suppressed: `onTipped` never fired, so the allowance was never refetched and no `tipped` record was written — and the control could then re-arm over money that was already gone. Cancel resets this control's UI; it does not abort the POST. **A landed transfer is reported rather than swallowed**; only the FAILURE path respects supersession, because there nothing moved. *(This bullet said "unconditionally" and then "once per mount"; both were superseded — the shipped rule is once per idempotency KEY. See the round-2 and round-3 sections.)* ⚠️ The previous revision had a test asserting the OPPOSITE (`onTipped` not called after a cancel) — it pinned the wrong proposition and has been rewritten.
- **The idempotency key omitted `entityType`/`entityId`**, which are sent in the body and recorded on the transaction. Changing the entity after a failed attempt reused the key, so a deliberate tip to a DIFFERENT object was collapsed into the first. Under-charge rather than double-charge, but wrong.
- **`.code === undefined` conflated a server message with a transport timeout**, and the README told blocks to render `.message` on that branch — which would put `IframeTransport: request … timed out after 600000ms` in front of a viewer. There is now a `timedOut` flag, set from a **typed** `RequestTimeoutError` rather than by matching the message wording. 🔴 It also does not mean no write occurred, and says so: the reply is what was lost, not necessarily the work.
- **Two unvalidated numbers on the money control**: `amount={0}` rendered "Tip 0" and posted it, and `remaining={NaN}` made `amount > remaining` false — so an unusable allowance did not merely fail to block, it silently REMOVED the ceiling.
- **The mock's `collectionFollows` option was write-only** — the reply echoes the request, as both real hosts do, so nothing could ever read the map. Seeding, mutating and merging it were no-ops; deleting it entirely left the whole suite green, and three claims about it (a JSDoc, a test name, a test comment) were false. **Removed rather than repaired**: there is no read op on this bridge for such a map to feed. A test now pins the stateless-echo property so re-adding one has to contend with a test rather than a comment.

**Known and NOT fixed here**, so it is open rather than absent: the SDK's copy of the closed refusal-code set is pinned against a literal *in this repo*, so it cannot detect the host gaining a code (verified by hand today; the repo has a cross-repo drift-guard pattern this could adopt). And the two new `/ui` controls ship no `*.browser.test.tsx`, unlike `ReportButton` and `ResourceCard` — both compose already-covered primitives, so this is a convention gap.

🔴 **Also surfaced, and it is a precondition this PR never stated:** the host half is on `civitai@main` but NOT on `origin/release`, and `release` is what builds production. So publishing this SDK is **not** the last gate — against today's production host a `FollowButton` press waits the full 10-minute human bound before failing. Nothing here adopts the controls, so nothing regresses; but "until this publishes, the bridge is inert" was only half the story.

## Audit round 2 — a regression the ROUND-1 FIX introduced

The delta re-audit dispositioned all ten round-1 claims: seven fixed, three partial. The partials matter more than the count:

- 🔴 **The round-1 fix made `onTipped` fire TWICE for one transfer.** "Report a landed transfer unconditionally" was right about the first POST and never considered the viewer retrying: Cancel does not abort POST #1, the retry sends POST #2 with the **same** idempotency key, the server collapses them into ONE transfer — and both promises resolve. Since `onTipped` is handed the amount precisely so a caller can decrement an allowance with it, that double-counts. The answer is **at most once**, held in a REF not in `done` (two promises resolving in one turn both read the same stale state). ⚠️ This round scoped it per MOUNT, which round 3 then found was wrong in the other direction — the shipped rule is once per KEY.
- **The `amount` guard covered the ARMING path only.** The prompt stays mounted across a re-render, so a parent moving `amount` to `0` after the viewer armed the control left an enabled Send that posted it — and an amount switcher mid-handshake is a flow this component's own JSDoc contemplates. Re-checked at the spend.
- **`!Number.isFinite(remaining)` swept together two OPPOSITE readings.** `NaN` is unusable and must block (every comparison against it is false, so it silently removed the ceiling); `Infinity` means the viewer has no limit, and blocking it refuses someone who is allowed everything. Now `Number.isNaN`.

**Two guards were passing with no killing test**, both found by mutation rather than by reading:

- The **echo half** of `FollowButton`'s correlation — mutating `stillOurs` to drop the id comparison left the *entire* suite green, because the case named for it was killed by the sibling ref check. The echo half is the only defence against a host echoing an id it was not asked about.
- `TipButton`'s **failure-supersession** guard — its test asserted only that the prompt was absent, which is true either way at that instant; a stale failure surfaces on the NEXT arm. The test now re-arms and reads the copy.

Also corrected: the class JSDoc, the hook's `@example` and this file's own bullet each still instructed the behaviour the `timedOut` flag exists to prevent (an IDE surfaces the first on hover); a count here quoted a number of failing cases that turned out to depend on where you draw the guard's boundary (independent re-derivations got 2, 3 and 4), so it is gone rather than corrected; and `RequestTimeoutError` is now exported, since `sendTypedRequest` — which throws it — already was.

🟢 **Stated, not fixed:** a `collectionId` round-trip (1 → 2 → 1) while a write for `1` is in flight discards the successful reply, so `onChange` never fires. That is the deliberate cost of releasing the in-flight marker on a prop change, and it is the mirror of the TipButton fix in the same PR — a landed write not reported. Reachable only from a control whose id oscillates during a consent dialog.

## Audit round 3 — the round-2 fix regressed the spend path, and inverted the money-report bug

Round 2's own fixes produced two more, which is the third consecutive round where a fix round introduced the next finding.

- 🔴 **The new spend-time gate read three of its four inputs through a STALE CLOSURE.** `confirm`'s dependency array listed `amount` but not `remaining`, `disabled` or `disabledReason`, so the gate decided a SPEND on frozen values — and there is no eslint in this repo to catch it. It failed in **both** directions: a parent topping up `remaining`, or clearing `disabled` (the "view still loading" usage this component's own JSDoc names), left Send **permanently refusing a perfectly good tip** with a message that is false about the amount; while the mirror cases the gate's comment claims to cover — the allowance dropping, a `disabledReason` appearing after arming — sailed straight through. 🔴 **It was consumer-dependent, which is why no test saw it:** an inline `onTipped={() => {}}` recreates the callback every render and hides it completely; a consumer doing the idiomatic `useCallback` gets the wedge. Every new case for it uses a **stable** `onTipped`.
- 🔴 **"At most once per mount" was wrong in the OPPOSITE direction from the bug it fixed.** Cancel does not abort POST #1, so if the parent then moves the amount a **new** key is minted and the server does *not* collapse the two — 150 Buzz moves while the app is told 50. Since `onTipped` is where a caller refetches the allowance and records its `tipped` flag, the second transfer left no record, re-creating the exact harm round 1 cited. Now scoped once per **key**.
- **`Number.isNaN` does not coerce**, so the round-2 `!isFinite` → `isNaN` fix silently dropped the type check and let `remaining: 'abc'` through — removing the ceiling, the wrong direction, and precisely what the comment it replaced claimed could not happen. There are **three** cases here, not two: non-number and `NaN` block, `Infinity` does not.
- Two comments the round-2 fix falsified are corrected in place rather than deleted: the JSDoc still said the success path "reports unconditionally", and the guard block still claimed `Number.isFinite` protected `remaining` from a non-number.

## Audit round 4 — clean on behaviour; the ladder stops here

Round 4 independently re-derived every round-3 claim by mutation, **including a positive control the earlier rounds' framing lacked**: reverting the dependency array *and* swapping the tests' stable `onTipped` for an inline lambda makes the suite pass again — proving the stale-closure bug is genuinely consumer-dependent and that the stable callback in those cases is load-bearing rather than decorative. It found **no behavioural defect in the shipped code**.

What it did find was a comment asserting `"once per mount"` directly above the line that implements once per **key** — the class that regenerates the bug, since a maintainer reading it would collapse the `Set` back to a boolean and 31 of 32 cases would still pass. Fixed, and **the shape was swept rather than the site**: two further instances turned up in this file's own round-1 and round-2 sections, both stating a superseded answer in the present tense. They now say so.

Also fixed while there: the spend gate emitted `"That amount cannot be sent."` for every refusal reason — false when the amount is fine and a real `disabledReason` is in hand, on a path round 3 had newly pinned. 🔴 **And the fix for that had its own defect, found by mutating it:** `disabledReason ?? …` renders a BLANK refusal for an empty-string reason, which still blocks (`blocked` tests `!== undefined`). `||`, not `??` — the same distinction as the error channel, three files apart.

**🔴 THE LADDER STOPS HERE, AND WHY IT WOULD NOT STOP ON ITS OWN.** Round 4's remaining findings are prose, so every fix round rewrites prose and manufactures the next prose finding; and because these comments live in shipped source, the attribution gate ("two consecutive rounds changing zero payload lines") can never fire on them. The stated criterion: no 🔴 · no blast radius beyond "a comment contradicts its code" · and the recurring SHAPE swept at every site rather than only the reported one. A round 5 whose entire input is a reworded sentence has nothing behavioural to audit.

**Left open, deliberately, so it is recorded rather than absent:** the changeset still quotes a count of killed mutants; the refusal-message change is pinned by three cases but not mutation-swept beyond the two directions above; and everything in "Not verified" below is unchanged.

## Verification

Suite 1355 → 1441 unit + 73 browser, typecheck and build clean across all five packages, README snippet gate 45/45 (positive-controlled: a deliberate type error in the new snippet fails it).

**44 mutants, 44 killed** (20 before the audits, then 11 / 6 / 4 / 3 on the fixes of rounds 1–4) — 🔴 one of round 4's SURVIVED first and was right to: it showed `??` blanking a refusal message, so the mutant's form was adopted, each by the test whose name states the property, none via an import failure, with a positive control proving the harness can go red: the timeout bucket, the hook's own `timeoutMs` opt-out (the reachability check — the ledger pin alone would pass for a request never wired), `??`-for-`||`, both refusal flags, a `.includes()` code check, an enum-only validator, the id-sign check, an unmapped `payloadValidatorFor` case, the echo-vs-guess adoption, the silent-decline branch, the sign-in routing, the optimistic flip, the allowance boundary (`>` vs `>=`), the idempotency key's amount component, a one-click tip, the mock's payload gate, a live host fabricating success, and dropping the message from the SDK union.

**Not verified, and not claimed:** no end-to-end run against a real host. The blocks in this repo cannot reach one, and `civitai#4666`'s own browser tier mocks `trpc.useUtils()`, so no real `collection.getById` response has ever been observed on either side of this bridge. Failure modes degrade to refusals by construction, so the failure direction is safe, but the happy path's rendered content is unproven against production.

## Pairing

`@civitai/blocks-react@0.48` needs `@civitai/app-sdk@>=0.38` — the hook imports `BlockCollectionFollowErrorCode` / `BlockCollectionFollowResult` from it. 🔴 The `peerDependencies` floor is deliberately NOT tightened: #206 widened it to `>=0.29.0 <1.0.0` precisely so an SDK minor stops forcing a major on consumers, and reversing that here would be a worse trade than the warning it buys. The consequence, stated rather than hidden: **npm will not warn about an under-paired install** — it fails at `tsc` with `Cannot find name 'BlockCollectionFollowErrorCode'`. The compat table in the README carries the pairing.

Adopting these in the first-party blocks is deliberately not part of this change — each needs the published version first.
