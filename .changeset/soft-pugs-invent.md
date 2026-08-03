---
'@civitai/app-sdk': minor
---

Add the `kind: 'step'` arm to `WorkflowBody`.

The host has shipped a step bridge — a code-reviewed, non-DB-editable registry of
orchestrator step types that a block can submit through `useBuzzWorkflow()` — but
the SDK's public wire type stopped at `textToImage` and `customComfy`, so there
was no typed client for it. This adds the missing member.

`WorkflowBodyStep` mirrors the host's `blockStepBodySchema` exactly:
`{ kind: 'step'; step: string; params: Record<string, unknown> }` and nothing
else, because that schema is `.strict()` and rejects any additional field rather
than dropping it. `step` is a registered step id resolved server-side against the
registry (an unregistered id is rejected fail-closed at the wire schema);
`params` are bounded and validated per-step by that entry's own `.strict()`
schema, which is why they are deliberately opaque here rather than mirrored — a
hand-copied param type in this package would drift against the authority
silently.

Additive for producers: every existing `WorkflowBody` still satisfies the union
unchanged. Consumers that `switch` exhaustively over `body.kind` will get a
compile error pointing at the new member, which is the intended behaviour.
