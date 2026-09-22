---
'@civitai/blocks-react': minor
---

Close the two ways `dev:live` diverged from the protocol it claims to mirror: three
block→parent messages that got no reply at all, and a picker that dropped a required
field (#386, #391).

**MINOR, not patch, and for two separate reasons.** `createLiveHost` gains capability it
did not have — `SHARED_GET` and `SHARED_REPORT` are now SERVED — which is new
functionality rather than a repair of existing functionality. And `#391` changes a
payload consumers RECEIVE: `RESOURCE_PICKER_RESULT.selected.modelType` was `undefined`
in `dev:live` and now carries the resolved type. No public API is removed or narrowed;
`@civitai/blocks-react/live` still exports exactly `createLiveHost` + `LiveHostOptions`.

---

### `SAVE_IMAGE`, `SHARED_GET` and `SHARED_REPORT` no longer hang for 30 seconds (#386)

`liveHost.ts`'s dispatch switch ends in `default: return` — a fall-through that sends
NOTHING back. Three block→parent types had no `case` at all, so a block calling
`useSaveImage().saveImage(…)`, `useSharedStorage().get(key)` or `.report(key, reason)`
under `dev:live` got silence, then a generic `RequestTimeoutError` after the 30 s
`DEFAULT_REQUEST_TIMEOUT_MS` — while the identical call resolved under `dev:mock`. The
developer's only evidence was "live is broken, somehow, after 30 seconds".

They were also the only three silent ones. Every other capability the live host cannot
serve already refuses explicitly, with a `logOnce` and an honest reply.

Two of the three are now **served**, one is **refused**, and the split is not arbitrary:

- **`SHARED_GET` → `apps.shared.get`** and **`SHARED_REPORT` → `apps.shared.report`**,
  on the same block-token convention as the eight `SHARED_*` bridges already forwarded.
  Neither needs host chrome or a session, so refusing them would have been a limitation
  this host does not actually have. `SHARED_GET` resolves a missing / hidden / withdrawn
  row to `item: null` with **no** `error` — a `?g=<key>` deep-link must not be able to
  tell "hidden from you" from "does not exist". The row mapper is now ONE function
  shared with `SHARED_LIST` instead of an open-coded copy, and it forwards `viewerVoted`
  when the server sends it, so a deep-linked row hydrates its vote button instead of
  guessing.

- **`SAVE_IMAGE` is REFUSED, and refusing is the point.** The real bridge is a security
  boundary, not a convenience: the host fetches the blob in its UNSANDBOXED top frame,
  allowlisting a `url`'s origin to the civitai image/blob CDN, and routing an `imageId`
  through the same per-viewer gated read that backs `GET_IMAGES_BY_IDS`. This harness
  has neither gate — the allowlist is the production host's, not this SDK's. A dev-side
  "download it anyway" would accept URLs production refuses and let a block ship having
  never once handled the refusal; inventing a divergent allowlist would be a security
  posture nobody reviewed, exercised only in dev. So it replies immediately with an
  actionable error naming `dev:mock`, rather than the silent 30 s hang.

The gap is now **structural**. `tests/guards/livehost-message-coverage.test.mjs` asserts
that every member of the protocol's own `BLOCK_TO_PARENT_MESSAGE_TYPES` is a `case` in
`liveHost.ts` (except `BLOCK_HELLO` / `BLOCK_MESSAGE_REJECTED`, which the protocol
documents as having no reply at all), that neither host cases on a label the protocol
does not declare, and that the live-vs-mock case-set difference is EXACTLY the declared
fire-and-forget ledger. `tsc` cannot make any of those claims: the switch subject is a
widened `string`, so the switch is exhaustive by construction and a typo'd label
type-checks.

🔴 The ledger fails on **GROW and SHRINK** — it is a set equality against a declared
expected difference, not a one-directional "every mock case exists in live". That
one-directional shape is exactly what let an extra `./css/tabs` subpath ship in #359.
Both directions were mutation-tested: adding a spurious live-only case and giving
`mockHost` a case for a live-only type each fail on the ledger's own assertion.

`liveHost.ts`'s header claimed `OPEN_BUZZ_PURCHASE` was "the ONE capability live mode
still cannot SERVE". That was already false when it was written — five other handlers
refused — and it is now corrected to the full list, with the reason each one refuses
([#14](https://github.com/civitai/civitai-app-starters/issues/14)).

### The live picker no longer drops the required `modelType` (#391)

`OPEN_RESOURCE_PICKER` with `resourceType: 'Checkpoint'` replied on
`RESOURCE_PICKER_RESULT` with a `cardToCheckpoint()` projection — five fields, **no
`modelType`** — while `BlockResourceInfo.modelType` is **required** and every consumer
reads it. The overlay branched its converter on the picker's REQUESTED TYPE
(`opts.type === 'Checkpoint'`), never on the channel it was replying to, and the live
host never passed the channel down at all.

The fix separates the two facts rather than patching the symptom: the reply channel now
travels with the request (`OpenPickerOptions.resultChannel`, required) and `selectCard`
branches on THAT. `cardToResource` already resolved `modelType` correctly — preferring
the card's own REST-reported type, falling back to the requested type — so a Checkpoint
asked for on the resource channel now comes back `modelType: 'Checkpoint'`.

**This is now a compile error, not just a test.** `PickerSelection` is discriminated by
`channel` and keyed to the shape that channel's consumers expect, so reintroducing the
bug — pairing `RESOURCE_PICKER_RESULT` with a `BlockCheckpointInfo` — fails `tsc` with
`Property 'modelType' is missing in type 'BlockCheckpointInfo' but required in type
'BlockResourceInfo'`. Measured, by reapplying the original branch.

🔴 The compiler covers ONE direction. The mirror mistake — a `BlockResourceInfo` sent
down the CHECKPOINT channel — is structurally assignable and `tsc` reports nothing
(measured: 0 errors). A runtime test pins that half instead, asserting the
checkpoint-channel payload still has exactly its five keys. The two channels keep two
contracts; they were deliberately not collapsed into one shape.

`PickerSelection`'s discriminant changed from `kind` (`'Checkpoint' | 'LORA'`) to
`channel`. Both it and `OpenPickerOptions` live in `src/internal/` and are not part of
any published subpath's export surface.
