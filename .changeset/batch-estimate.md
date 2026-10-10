---
'@civitai/blocks-react': minor
'@civitai/app-sdk': minor
---

**`useBatchEstimate()` prices a grid of generations in one request (#578, item 1).** `const { estimateBatch } = useBatchEstimate()`, then `estimateBatch(bodies)` sends up to 16 workflow bodies, each exactly what `useBuzzWorkflow().estimate()` takes. It resolves with `{ cells, aggregate }`: `cells[i]` answers `bodies[i]`, either `{ ok: true, cost, snapshot }` or `{ ok: false, error, snapshot }`, where `error` is the same `WorkflowEstimateError` a single `estimate()` of that body rejects with. `aggregate` is `{ total, pricedCells, cellCount }`. `total` sums the cells that priced and covers the whole list only when `pricedCells === cellCount`.

- 🔴 **RELEASE HOLD: do not release this until civitai/civitai#5696 is merged and deployed to civitai.com.** A host without it does not answer the message at all, so `estimateBatch` waits out its timeout (120 s by default) before rejecting.
- **Estimate only.** Nothing is submitted and no Buzz is held or spent. There is no batch submit, watch or cancel. Each cell is still submitted with `useBuzzWorkflow().submit()` and its own confirmation.
- **One request against the estimate allowance per call**, however many cells. Cells are metered on an allowance of their own, shared the same way (on a page app, by every viewer of the app). A call over either limit is refused whole.
- `kind: 'training'` bodies are refused per cell; estimate a training run with `estimate()`.
- **Whole-call failures reject with `BatchEstimateError`**, whose `code` is one of `'unsupported'` (the host answered `unsupported on this host`), `'timeout'` (no reply, which is also what a host that predates the message looks like), `'invalid-request'` (empty, or more than `BATCH_ESTIMATE_MAX_CELLS` = 16 bodies, refused before sending) or `'failed'` (anything else, with the host's text on `hostError`). On `'unsupported'` or `'timeout'`, fall back to one `estimate()` per cell; the README shows how. `estimateBatch(bodies, { timeoutMs })` shortens the wait.
- New exports: `useBatchEstimate`, `BatchEstimateError`, `BATCH_ESTIMATE_MAX_CELLS`, and the types `UseBatchEstimate`, `BatchEstimateResult`, `BatchEstimateCell`, `BatchEstimateErrorCode`, `EstimateBatchOptions`, `BlockEstimateBatchAggregate`.
- `@civitai/app-sdk`: the message union gains `ESTIMATE_WORKFLOW_BATCH { requestId, bodies }` and `ESTIMATE_BATCH_RESULT { requestId, snapshots?, aggregate?, error? }`, plus the `BlockEstimateBatchAggregate` type on `./blocks`.
- The reply validator accepts `ESTIMATE_BATCH_RESULT` with either a bare string `error` or `snapshots` (each a valid workflow snapshot) plus a numeric `aggregate`. It refuses anything else.
- **Mock host (`createMockHost` / `Harness`):** prices each cell exactly as it prices one `ESTIMATE_WORKFLOW` of that body. `costPerGen` and `failEstimate` apply per cell, and a training cell is refused as the server refuses it. New option `generation.batchEstimate`: `'supported'` (default), `'unsupported'` (replies `unsupported on this host`) or `'silent'` (never replies, like an older host). It can be changed at runtime through `setScenario`.
- **`dev:live`** forwards the call to `blocks.estimateWorkflowBatch`. Against a civitai.com without that procedure it rejects with `'failed'` (the server's not-found text), not `'unsupported'`.
