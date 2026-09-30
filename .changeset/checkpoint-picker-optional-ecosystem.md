---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

feat: make `baseModelGroup` OPTIONAL on `useCheckpointPicker` — an unconstrained checkpoint pick

`useCheckpointPicker().open()` required `baseModelGroup`, and the wire type in
`@civitai/app-sdk` declared it required too. That made "pick a checkpoint from
any ecosystem" inexpressible: the only family a block can name is the one it is
already in, so the picker could only ever offer the ecosystem the user was
trying to leave. Every other family was unreachable for the life of the session.

The host never required it. `resolveCheckpointPickerRequest` in
`PageBlockHost` treats the field as optional and its unit tests already pin that
a bare `requestId` is a valid request; an absent or unresolved group produces
`baseModels: []`, which the picker's three consuming layers each special-case as
*no narrowing* — the emitted clause is the bare `type = Checkpoint`, i.e. ALL
generation-covered checkpoints, not none. The model-slot host behaves the same
way. The `required` was an SDK-side restriction only.

`baseModelGroup` is now optional in both packages, and omitting it sends the key
ABSENT from the wire payload rather than present-and-undefined. An empty string
is normalized to absent for the same reason: on the host, `getBaseModelGroup('')`
resolves to the real ecosystem key `'Other'`, and the model-slot host does not
strip it — so `''` would narrow the picker to the Other family instead of
widening it. Absence is the only spelling that means "unconstrained" on both
host surfaces.

Backward compatible **for CALLERS**: existing callers that pass a family keep
the exact behaviour they have today.

Not unconditionally backward compatible for **IMPLEMENTERS**. `open` is relaxed
from `(opts: {…})` to `(opts?: {…})`, so anything that *implements* the exported
`UseCheckpointPicker` type — a test double or fake typed as it, not a consumer
of the hook — now has to accept a missing argument and stops type-checking
until it does. Enumerated: the only references to the exported type are its own
declaration, the `index.ts` re-export and the `Exact<ReturnType<typeof
useCheckpointPicker>, UseCheckpointPicker>` row in `returnTypeLedger.ts` — which
the hook itself satisfies. No independent implementer exists here, and the
`civitai/cli` page-money scaffold's picker double is an untyped `vi.fn()`. That
is why this is `minor` rather than `major` per RELEASING.md — a new
optional argument and looser input acceptance. If one appears before release,
re-grade it.
