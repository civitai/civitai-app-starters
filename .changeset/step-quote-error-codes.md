---
'@civitai/app-sdk': minor
'@civitai/blocks-react': patch
---

**A registered-step estimate with no price quote now fails with an `errorCode` instead of showing the step's declared price.**

`KnownBlockWorkflowErrorCode` gains three values. They apply to a REGISTERED `kind: 'step'` body (one with a `step` id), not the pass-through `$type` arm. Each arrives on `estimate()` (which rejects with `WorkflowEstimateError`) and on that body's cell of a batch estimate, as `{ workflowId: 'failed', status: 'failed', error, errorCode }` with no `cost`:

| `errorCode` | Means | `error` |
|---|---|---|
| `'step_quote_rejected'` | the orchestrator refused the request; resending the same body will not help | `No price quote for this step: the orchestrator rejected the request: <reason>` when the reason is safe to show, else `No price quote for this step: the orchestrator rejected the request; check the step inputs and references (retrying the same body will not help)` |
| `'step_quote_unavailable'` | no usable answer; the one a retry can clear | `No price quote for this step: none could be obtained; try again` |
| `'step_quote_unpriced'` | the orchestrator answered without a price | `No price quote for this step: the orchestrator answered without one` |

`submit()` is unchanged.

`@civitai/blocks-react`: README only — a refusal table for the three codes. The mock host always quotes a registered step, so it does not send them.
