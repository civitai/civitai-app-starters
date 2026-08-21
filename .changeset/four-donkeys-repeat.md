---
'@civitai/blocks-react': minor
---

`useBuzzWorkflow().estimate()` now REJECTS when the host answers with a failure
snapshot, instead of resolving it as a successful estimate that happens to carry
no cost (civitai/civitai#4159).

A server-side `blocks.estimateWorkflow` error cannot reach the block as a
rejection — the reply crosses `postMessage` — so the host posts a well-formed
`ESTIMATE_RESULT` carrying `{ workflowId: 'failed', status: 'failed', error }`
with no `cost`. `estimate()` used to resolve that and move the hook to
`'confirming'`, so a block that correctly gates Confirm on
`typeof snapshot.cost?.total === 'number'` rendered a confirm dialog it could
never confirm ("Cost unavailable"), while the server's explanation — already
present on `snapshot.error` — was discarded.

It now throws the exported `WorkflowEstimateError`, whose `message` is the
server's own message and whose `.snapshot` carries the raw reply, so nothing
that was reachable before is lost.

MIGRATION: callers that already wrap `estimate()` in `try/catch` (the shape the
hook's docs and every starter use) need no change — an errored estimate now
lands in that catch instead of silently producing an unconfirmable dialog. A
caller that inspected `snapshot.status` itself should read `err.snapshot`
instead.

`submit()` is deliberately unchanged: there a failure-shaped snapshot is a
documented OUTCOME to recover from (an over-budget submit returns
`status:'failed'` so the block can open a top-up flow), not an error.
