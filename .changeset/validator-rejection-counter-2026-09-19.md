---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Count validator rejections — the one App Blocks bridge silence the host cannot see.

Four of the bridge's drop paths are host-side and counted since civitai#4946 (`civitai_app_block_bridge_messages_total` over `{handled, no_handler, rate_limited, deduped, no_token}`). This adds the SDK-side one: an inbound reply that fails `internal/validate.ts` is dropped with nothing but a `console.warn`, the block's pending request never settles, and the UI hangs to its request timeout with no network call and no host-visible error. The host cannot see it — the check runs in the iframe *after* the host has already replied, so from the host's side the exchange reads `handled`.

⚠️ **"the fifth and final silence" would be an overstatement, so this does not claim it.** `IframeTransport.handleMessage` still drops silently, uncounted, in at least three more places: an origin mismatch and a non-object/non-string-`type` body both bare-`return` before any validator runs, and a WELL-FORMED reply whose `requestId` matches no pending entry — or matches one awaiting a different `responseType` — falls off the end of the function and hangs the request identically. This closes the one path card 625 names and the one that caused the 2026-09-18 incident; it is not an enumeration of the class.

**It is the drop path with a confirmed production incident.** On 2026-09-18 `custom-generators` served *"Couldn't load your kept images just now."* from relist until a human found it by hand: since civitai#4895 a viewer's own unrated image returns `visible + ratingPending` with no `nsfwLevel`, `isValidGatedImage` still required the level, `isValidImagesResult` failed the whole reply on one entry, and `GET_IMAGES_BY_IDS` hung to its 30s timeout — while `civitai_app_block_renders_total` read `result=ok, error_class=none` throughout, because that metric fires once per mount and is blind to anything after ready. (The validator itself was fixed in #307; this is the instrumentation that would have surfaced it in a scrape interval instead of 15 days.)

**`@civitai/app-sdk`**

- New fire-and-forget block→host message `BLOCK_MESSAGE_REJECTED`, payload `{ type }`. No `requestId`: it reports a drop that already happened, so there is nothing to correlate and nothing to reply to.
- New `BLOCK_TO_PARENT_MESSAGE_TYPES`, `OTHER_MESSAGE_TYPE_LABEL` and `boundBlockToParentMessageType` — the runtime mirror of the `BlockToParentMessage` union plus its clamp, held to the union in both directions by a bidirectional `Exclude` gate in `messages.ts` and by a runtime test that re-derives the union from that file's own source.

**`@civitai/blocks-react`**

- `IframeTransport` posts `BLOCK_MESSAGE_REJECTED` at the drop site, naming the block→host request left hanging (`'other'` for a rejected host push, which hangs nothing). The `console.warn` stays and now names the TOP-LEVEL validator that rejected plus the request that will hang — not the nested helper, which no validator reports at runtime and which therefore remains unavailable from any surface.
- **No emit budget, and no undercount.** Magnitude on this path is unbounded exactly as it already is for `no_handler` and `deduped`: the host consumes the report in its shared dispatcher ABOVE the 30 msg/sec limiter, so a report burns none of the budget `BLOCK_ERROR` needs, and the host's own `BRIDGE_MESSAGE_COUNT_MAX` plus the beacon's coalescing are what bound a flood. A cap here would have made a flood read *small*, which is the one shape of wrongness `bridgeLabels.ts` explicitly rejects.
- Nothing is reported before `BLOCK_INIT`: with no `parentOrigin` a report could only be queued, and the host's ~400ms init retry makes that queue a producer with no consumer. The gap is already covered by `civitai_app_block_renders_total{result="timeout"}`.

**`type` is the REQUEST type, not the rejected reply's,** and that is load-bearing rather than a preference: the host bounds its `type` label against the code-owned block→host inventory, which contains no `*_RESULT` key (measured: 0 of 46), so reporting `IMAGES_RESULT` would clamp to `'other'` server-side and collapse every rejection in the protocol onto one label.

**Why `minor` for both.** Additive on the wire and in the type surface: a host that does not handle the new message records one `no_handler` and, because the payload carries no `requestId`, sends no NACK. Nothing that compiled before stops compiling. Consuming the count requires the mirrored civitai change (a sixth `outcome` value `validator_rejected`, the new type in `hostHandlerParity.ts`'s `INVENTORY`, and the dispatcher branch): civitai/civitai#4977.

⚠️ **There is NO publish-ordering hazard, and an earlier revision of this changeset claimed one.** It said the civitai change "must land before this publishes", because that repo's compile-time gate asserts every *published* SDK block→host type is an `INVENTORY` key. The gate is real and one-directional as described, but it reads the **installed** package — and civitai pins `@civitai/app-sdk` at `^0.14.0`, lockfile-resolved to `0.14.0`, while npm latest is already `0.44.0`. Its `INVENTORY` therefore runs **25** keys ahead of what it compiles against (47 inventory keys against the 22 members the installed 0.14.0 union declares — an earlier revision said "~22", which is the union SIZE, not the gap), and publishing cannot redden its `main`; only a dependency bump inside that repo can. Either order is safe. Verified against `package.json` and `pnpm-lock.yaml`, not inferred.
