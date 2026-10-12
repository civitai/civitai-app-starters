---
'@civitai/blocks-react': minor
---

**`useWorkflowBatch()` watches a grid of submitted workflows and cancels them together (#578, item 3).** `const { cells, summary, cancelAll, rewatch } = useWorkflowBatch(workflowIds)`. Each cell is still submitted with `useBuzzWorkflow().submit()` and its own confirmation; there is no batch submit.

- **The array of ids is the batch.** There is no server-side batch id and no host change. Persist the array and pass it back to re-attach after a reload.
- **One poll in flight per workflow.** Each cell is one ordinary `watch()`. A restarted loop waits for the previous loop's in-flight poll. `options` (`intervalMs`, `waitSeconds`, `timeoutMs`, `maxRetries`) go to every cell's `watch()`.
- **At most `WORKFLOW_BATCH_MAX_CELLS` = 30 ids**, the poll allowance (1,200 per 60 s per block instance and viewer) divided by one watch's 40 polls a minute. A longer list, a duplicate, an empty id or a `'failed'`/`'whatif'` placeholder throws.
- **`summary`**: `total`, `running`, `succeeded`, `failed`, `canceled`, `expired`, `stopped`, `realisedCost` (the sum of `cost.total` on terminal snapshots, as the host reported it; the author fee is not included), `costedCells`, `settled`.
- **A host failure placeholder (`workflowId: 'failed'`) is never counted as a workflow outcome.** On a poll it stops the cell (`phase: 'stopped'`, `error` set); call `rewatch()`. On a cancel it is a `failed` cancel.
- **`cancelAll()`** resolves with `{ canceled, alreadySettled, refused, notAttempted, failed, complete }`. Cancels share the estimate allowance (150 per 10 s per block instance), so at most four are in flight, and after the first refused cancel (`status: 'processing'`) the rest are not sent. Nothing is retried automatically; call it again when `complete` is `false`.
- **Unmounting stops every poll.**
- New exports: `useWorkflowBatch`, `WORKFLOW_BATCH_MAX_CELLS`, and the types `UseWorkflowBatch`, `WorkflowBatchCell`, `WorkflowBatchCellPhase`, `WorkflowBatchCancelState`, `WorkflowBatchCancelResult`, `WorkflowBatchSummary`, `WorkflowBatchOptions`.
- **Mock host (`createMockHost` / `Harness`):** a cancelled workflow now stays `canceled` on later polls (it used to count down to `succeeded`), cancelling a finished workflow reports its real status, and polling an id the mock did not submit counts down to done instead of answering `processing` forever. New options `generation.cancelRefused` (`true` or a list of ids: answer cancels with the host's refusal, `status: 'processing'`) and `generation.workflowOutcome` (`(workflowId, body) => 'succeeded' | 'failed' | 'expired'`). Both can be changed through `setScenario`.
