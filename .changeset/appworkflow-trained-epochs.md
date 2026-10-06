---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Add `trainedEpochs` to `AppWorkflow` rows.

**`AppWorkflow.trainedEpochs` (`@civitai/app-sdk`).** The app-queue read
(`useAppWorkflows` / `QUERY_APP_WORKFLOWS`) can now report a training run's
epochs on each row, so a block can offer "publish epoch n" from its queue
without polling each run. Same shape and rule as
`BlockWorkflowSnapshot.trainedEpochs`: only moderation-approved runs are listed,
the checkpoint itself is not exposed, and the field is omitted when there are no
epochs. Optional, and absent on hosts that do not emit it yet.

**Validator (`@civitai/blocks-react`).** The `AppWorkflow` row guard (used by
both `APP_WORKFLOWS_RESULT` and `CANCEL_APP_WORKFLOW_RESULT`) now shape-checks
`trainedEpochs` when present, through the same helper as the snapshot guard:
absent is valid, present-but-malformed drops the reply, and `$type` is checked as
a string so a host adding a value does not break shipped blocks.

**Mock host.** The app-queue read still replies with the canned `appWorkflows`
rows verbatim — they carry no body, so the mock cannot tell a training row from
any other. Put `trainedEpochs` on the rows you pass there; it reaches the hook
intact.
