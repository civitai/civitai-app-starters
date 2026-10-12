---
'@civitai/blocks-react': minor
---

**The mock host now enforces `ai:write:budgeted` on estimate, batch estimate and submit, as the real server does (#608).**

civitai's `estimateWorkflow`, `estimateWorkflowBatch` and `submitWorkflow` refuse a token without the spend scope with `FORBIDDEN 'block lacks ai:write:budgeted scope'`, before any pricing. `createMockHost` / `Harness` used to check that only on the training paths, so the refusal → `requestConsent()` → `TOKEN_REFRESH` → retry loop could not be exercised in `pnpm dev` or in a test. While `consentGranted` is `false` (the default, because production's first token lacks the scope), the mock now refuses all three, each in the shape the page host sends:

- `ESTIMATE_WORKFLOW` → `ESTIMATE_RESULT { snapshot: { workflowId: 'failed', status: 'failed', error } }` (no `cost`). `estimate()` rejects `WorkflowEstimateError` code `'failed'`.
- `ESTIMATE_WORKFLOW_BATCH` → `ESTIMATE_BATCH_RESULT { requestId, error }`, the whole call. `estimateBatch()` rejects `BatchEstimateError` code `'failed'` with the text on `hostError`.
- `SUBMIT_WORKFLOW` → `WORKFLOW_SUBMITTED { snapshot: { workflowId: 'failed', status: 'failed', error } }` (no `cost`). `submit()` still resolves by default: its consent prompt-and-retry asks, the mock grants and pushes a refreshed token, and the retry re-sends the same idempotency key, so the viewer is charged once. With `consentGrantable: false` it rejects with code `'exception'`.

The host's own gates that run before the server (the batch request-shape checks and the idempotency-key format) still answer first, and the `failEstimate` / `failSubmitException` knobs still win over the refusal, so a forced failure shows what the knob asked for.

**Migration.** A test or harness that estimates or submits against the default mock and is not about consent now needs `consentGranted: true` (or `?consent=granted` in the dev harness). Without it, `estimate()` and `estimateBatch()` reject, and `submit()` makes an extra consent round-trip before it resolves. A test that IS about consent can now drive the whole loop: estimate, see the refusal, `requestConsent({ scopes: ['ai:write:budgeted'] })`, wait for the scope on `useBlockToken().scopes`, estimate again.

The internal `MOCK_TRAINING_SCOPE_ERROR` constant is renamed `MOCK_SPEND_SCOPE_ERROR`, since every money path now uses it (it was never exported from a public subpath).
