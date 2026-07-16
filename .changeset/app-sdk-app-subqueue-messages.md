---
'@civitai/app-sdk': minor
---

Add the app generator **subqueue** message contract to `@civitai/app-sdk/blocks`:
the `QUERY_APP_WORKFLOWS` → `APP_WORKFLOWS_RESULT` and `CANCEL_APP_WORKFLOW` →
`CANCEL_APP_WORKFLOW_RESULT` message pairs, plus the shared `AppWorkflow` /
`AppWorkflowImage` types and the `AppWorkflowsParams` filter. These let an app read
and cancel its **own** tag-scoped generations (`{ workflowId, status, images[],
cost, createdAt }`) — the host forces the per-app tag filter off the block token,
so a block only ever sees the queue it produced. Mirrors civitai/civitai PR #3164
(keep in lockstep).
