---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**Refuse a malformed `idempotencyKey` before it reaches the host.**

A block composed its key as `sheetId:panelId:nonce`. It passed 201 local tests,
the dev harness and review, then failed **every** save in production:

```json
{ "code": "invalid_format", "format": "regex",
  "pattern": "/^[A-Za-z0-9_-]{1,64}$/",
  "path": ["idempotencyKey"],
  "message": "Invalid string: must match pattern /^[A-Za-z0-9_-]{1,64}$/" }
```

`BAD_REQUEST` / 400 on `blocks.submitWorkflow`. Nothing in this repository
modelled the rule: the SDK's key *generator* was tested against the charset, but
`crypto.randomUUID()` and the `idem-<base36>` fallback both conform by
construction and always did — so the only guard that existed covered the half
that cannot fail, while a **caller-supplied** key went through unexamined at
every hook and the dev mock host had no concept of `idempotencyKey` at all.

- **`@civitai/app-sdk`** — new `blocks/idempotency.ts`, exported from
  `@civitai/app-sdk/blocks`: `BLOCK_IDEMPOTENCY_KEY_REGEX`,
  `BLOCK_IDEMPOTENCY_KEY_MAX_LENGTH`, `isValidBlockIdempotencyKey` and
  `blockIdempotencyKeyRejection`. It records the provenance (the host's
  `block-gen-idempotency.ts:77`), the **four** host entry points that enforce it,
  why the 64 bound is derived from the orchestrator's 128-char `externalId`
  ceiling, and why the colon ban is a correctness invariant: the host composes its
  per-`(user, app, key)` redis keys with `:` as the delimiter and documents them
  as injective *because* the key is colon-free.
- **`@civitai/blocks-react`** — `useBuzzWorkflow().submit`, `useTip().tip` and
  `useGoodPurchase().purchase` now **refuse** a malformed caller-supplied key
  before anything is sent, throwing the new exported
  `InvalidIdempotencyKeyError`. The dev mock host gained a format gate ahead of
  its message switch, so the defect surfaces in `pnpm dev` and in the suite
  instead of in production.
- **`TipButton` is fixed — it was a second, live production defect.** It composed
  `${useId()}:${toUserId}:${amount}:${entityType}:${entityId}`, and it always
  supplies a key, so **every tip it posted was rejected by the host with the same
  400**. The delimiter is now `_` and the seed is normalised. Measured on the
  React resolved here (19.2.6): `useId()` returns `_r_0_`, which clears the
  charset alone, while `_r_0_:123:50:Image:99` does not — so here the delimiters
  were the whole fault. Reported separately, not measured by this change: React
  18.3.1 returns `":R0:"` and early React 19 a guillemet-wrapped id, both of
  which fail on their own. The peer range admits `^18.0.0 || ^19.0.0`, so the
  seed is normalised either way.
- **`useTip`'s `@example` recommended `React.useId()` as the key** — a live
  defect for the same reason: anyone copying it on React 18 shipped a guaranteed
  400. Replaced with a stable domain id (the better key — it identifies the
  logical tip rather than the component instance, so it survives a remount) and,
  as a second example, `generateIdempotencyKey()`, which is now **exported** from
  the package, because a documented alternative has to be reachable.
- **All three `idempotencyKey` JSDocs now state the constraint** — charset, the
  64 bound, no colons, and that the host 400s otherwise, with the right error
  envelope per path. `civitai-developer-docs` generates its public hook reference
  from these JSDocs, so the constraint could not reach the published docs until
  the JSDoc carried it.

### Why MINOR and not patch

**It refuses input that was previously forwarded.** A block passing a
non-conforming key used to get a 400 from the host; it now gets a thrown
`InvalidIdempotencyKeyError` from the SDK. The outcome was already a failure in
both cases — no working call becomes a failing one — but the *failure mode*,
*type* and *timing* all change, and a caller with a `try/catch` around `submit()`
that branched on `WorkflowSubmitError` will now see a different class. That is a
behaviour change at a public boundary, so it is not a patch.

**It is not a major.** Pre-1.0, a major would mean `1.0.0`, and these packages are
deliberately still v0 — the same reasoning the storage-scope gate shipped under
in `0.62.0`.

### Why REFUSE and never sanitise

An idempotency key is an **identity**. Silently rewriting a caller's key breaks
the exact property the key exists to provide: two distinct logical submits could
collapse onto one slot (one charge for two intended operations), or a retry could
be normalised differently from its first attempt and mint a **second**
reservation. Both are money bugs and both are quieter than a rejection, so the
SDK refuses and says so. `InvalidIdempotencyKeyError` is a distinct class rather
than a reuse of the existing money-path errors because those are all
money-*ambiguous* by design — `WorkflowSubmitError`'s `'exception'` arm covers "a
lost response or an in-progress idempotency conflict", and the abort/timeout
rejections say the charge may or may not have landed. A key refused at the
boundary is unambiguous: nothing left the iframe, so the caller gets a type that
says so.

### Peer floor

`@civitai/blocks-react`'s `@civitai/app-sdk` peer floor moves `>=0.49.0` →
`>=0.55.0`, because its transport value-imports three symbols that first exist in
this app-sdk release. Measured absent from 0.49.0, 0.53.0 and 0.54.0 (the newest
published), with `BLOCK_SCOPES` present as the positive control and an impossible
symbol absent as the negative one. `changeset version` cannot do this
automatically — `onlyUpdatePeerDependentsWhenOutOfRange` only rewrites a range the
computed version *fails*.
