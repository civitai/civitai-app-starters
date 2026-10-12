---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

**A training price-quote refusal now carries a machine-readable `errorCode`.** `BlockWorkflowSnapshot` gains an optional `errorCode`, a stable companion to `error` for a block to branch on instead of matching the prose. The host already sends it (civitai/civitai#5689 is live); until now the SDK did not declare it.

- **Where it appears:** the refusal for a pass-through `step` body whose `$type` is a training type (`'training'` or `'imageResourceTraining'`) when the host could not get a price quote: `{ workflowId: 'failed', status: 'failed', error, errorCode }` with no `cost`. That is the reply to `estimate()` (rejects with `WorkflowEstimateError`), to `submit()` (rejects with `WorkflowSubmitError`, before anything is reserved), and to that body's cell in a batch estimate. Read it from `err.snapshot.errorCode`. The `kind: 'training'` arm does not set it.
- **Known values** (new exported type `KnownBlockWorkflowErrorCode`): `'training-quote-rejected'` (the request itself was refused; resending it will not help), `'training-quote-unavailable'` (no usable answer; a retry may succeed), `'training-quote-unpriced'` (answered without a price).
- 🔴 **An unknown value is possible.** The field is typed `KnownBlockWorkflowErrorCode | (string & {})`, the host may add codes, and the inbound validator accepts any string. Keep a default branch.
- **Absent** on every other reply and from a host that predates the field.
- The inbound snapshot validator accepts the field and refuses a present value that is not a string, as it does for the other optional snapshot fields. (Earlier `@civitai/blocks-react` releases already delivered the field untouched at runtime, since the validator does not strip unknown keys; it was just untyped and unchecked.)
- **Mock host:** unchanged. It does not quote training steps, so it has no refusal to attach a code to.
