---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

RELEASE HOLD: mirrors civitai/civitai#5812, which is merged but not yet deployed. Until civitai.com runs it, an estimate of an unpriced `kind: 'workflow'` body still resolves with the spend ceiling as `cost.total`; release this once #5812 is live.

**A `kind: 'workflow'` estimate with no price quote now fails with an `errorCode` instead of showing the spend ceiling as the price.**

`KnownBlockWorkflowErrorCode` gains three values. Each arrives on `estimate()` (which rejects with `WorkflowEstimateError`) and on that body's cell of a batch estimate, as `{ workflowId: 'failed', status: 'failed', error, errorCode }` with no `cost`:

| `errorCode` | Means | `error` |
|---|---|---|
| `'workflow_quote_rejected'` | the orchestrator refused the body; resending the same body will not help | `No price quote for this workflow: the orchestrator rejected the request: <reason>` when the reason is safe to show, else `No price quote for this workflow: the orchestrator rejected the request; check the step inputs and references (retrying the same body will not help)` |
| `'workflow_quote_unavailable'` | no usable answer; the one a retry can clear | `No price quote for this workflow: none could be obtained; try again` |
| `'workflow_quote_unpriced'` | the orchestrator answered without a price | `No price quote for this workflow: the orchestrator answered without one` |

`submit()` is unchanged: the same unquoted body still proceeds, reserved at the app's per-generation budget × the number of steps. A failed estimate does not predict a refused submit. A workflow with a training step or a `repeat` is still refused on both, with the codes it had (`training-quote-*`, `workflow_repeat_unbounded`); the message now states the cause (`workflow step N: a workflow with a repeat needs a price quote and <cause>`), and only `none could be obtained; try again` is one a retry of the same body can clear.

**Migration.** An app that renders `cost.total` from a workflow estimate should catch `WorkflowEstimateError` and branch on `err.snapshot.errorCode`. The docs no longer say that an estimate equal to the ceiling may be unpriced; that remains true only of a host without #5812.

**Mock host (`@civitai/blocks-react/testing`).** `generation.workflowUnpriced` now also takes the cause, `'rejected' | 'unavailable' | 'unpriced'` (type `MockWorkflowQuoteFailure`); `true` keeps working and means `'unavailable'`. With it set, `estimate()` of a workflow with no training step or `repeat` now FAILS with `workflow_quote_<cause>` and the host's message, where 0.71.0 priced it at `buzzBudget` × steps; `submit()` still proceeds at that ceiling with no fee. The training and `repeat` refusals carry the chosen cause (`training-quote-<cause>`). A test that asserted the ceiling as the mock's unpriced estimate now sees a rejection.
