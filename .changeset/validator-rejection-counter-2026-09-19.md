---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Count validator rejections — the one App Blocks bridge silence the host cannot see.

The bridge has five ways to drop a message, all producing identical silence. Four are host-side and counted since civitai#4946 (`civitai_app_block_bridge_messages_total` over `{handled, no_handler, rate_limited, deduped, no_token}`). The fifth is SDK-side: an inbound reply that fails `internal/validate.ts` is dropped with nothing but a `console.warn`, the block's pending request never settles, and the UI hangs to its request timeout with no network call and no host-visible error. The host cannot see it — the check runs in the iframe *after* the host has already replied, so from the host's side the exchange reads `handled`.

**It is the one of the five with a confirmed production incident.** On 2026-09-18 `custom-generators` served *"Couldn't load your kept images just now."* from relist until a human found it by hand: since civitai#4895 a viewer's own unrated image returns `visible + ratingPending` with no `nsfwLevel`, `isValidGatedImage` still required the level, `isValidImagesResult` failed the whole reply on one entry, and `GET_IMAGES_BY_IDS` hung to its 30s timeout — while `civitai_app_block_renders_total` read `result=ok, error_class=none` throughout, because that metric fires once per mount and is blind to anything after ready. (The validator itself was fixed in #307; this is the instrumentation that would have surfaced it in a scrape interval instead of 15 days.)

**`@civitai/app-sdk`**

- New fire-and-forget block→host message `BLOCK_MESSAGE_REJECTED`, payload `{ type }`. No `requestId`: it reports a drop that already happened, so there is nothing to correlate and nothing to reply to.
- New `BLOCK_TO_PARENT_MESSAGE_TYPES`, `OTHER_MESSAGE_TYPE_LABEL` and `boundBlockToParentMessageType` — the runtime mirror of the `BlockToParentMessage` union plus its clamp, gated against the union in both directions by an embedded type assertion, a `.test-d.ts` assertion, and a runtime source-derived test.

**`@civitai/blocks-react`**

- `IframeTransport` posts `BLOCK_MESSAGE_REJECTED` at the drop site, naming the block→host request left hanging (`'other'` for a rejected host push, which hangs nothing). The `console.warn` stays and now names the validator that rejected and the request that will hang.
- Reports are budgeted at 30 per 10s window per transport, so a broken-reply flood cannot become a postMessage flood on a bridge whose inbound budget is 30/sec.

**`type` is the REQUEST type, not the rejected reply's,** and that is load-bearing rather than a preference: the host bounds its `type` label against the code-owned block→host inventory, which contains no `*_RESULT` key (measured: 0 of 46), so reporting `IMAGES_RESULT` would clamp to `'other'` server-side and collapse every rejection in the protocol onto one label.

**Why `minor` for both.** Additive on the wire and in the type surface: a host that does not handle the new message records one `no_handler` and, because the payload carries no `requestId`, sends no NACK. Nothing that compiled before stops compiling. Consuming the count requires the mirrored civitai change (a sixth `outcome` value `validator_rejected`, the new type in `hostHandlerParity.ts`'s `INVENTORY`, and a handler on both hosts), which must land there **before** this publishes — civitai's compile-time gate asserts every published SDK block→host type is an `INVENTORY` key, and its `INVENTORY` may legitimately run ahead of the published union but not behind it.
