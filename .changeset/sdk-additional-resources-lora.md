---
"@civitai/app-sdk": minor
---

Add optional `additionalResources` (LoRA) field to the `WorkflowBody` block→host
contract. Mirrors civitai's `blockWorkflowBodySchema` (PRs #2640/#2641): an
optional array of `{ modelVersionId: number; strength?: number }` (max 5 entries;
strength in `[-1, 2]`, server-defaulted to 1) layered on top of the checkpoint
`modelVersionId`. The server is LoRA-only for additional resources and enforces
base-model-family compatibility + per-resource entitlement before any Buzz spend.

Purely additive and backward-compatible — existing checkpoint-only bodies that
omit the field still type-check, and the host already forwards the block body
verbatim so no host change is required. `@civitai/blocks-react` consumes
`WorkflowBody` by reference (`useBuzzWorkflow().submit / .estimate`), so blocks
can now pass LoRAs through with full type safety.
