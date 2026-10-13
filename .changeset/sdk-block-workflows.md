---
'@civitai/sdk': minor
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
---

**`@civitai/sdk`: `app.workflows`, generation for a block, multi-step workflows included.**

A block built on `@civitai/sdk` can now estimate, submit, follow and cancel a generation without hand-writing requests or importing types from another package:

```ts
import { initialize, type WorkflowBody } from '@civitai/sdk';

const app = await initialize();
const body: WorkflowBody = { kind: 'workflow', steps: [/* … */] };

const estimate = await app.workflows.estimate(body);
if (estimate.status !== 'failed') {
  const submitted = await app.workflows.submit(body, { idempotencyKey: crypto.randomUUID() });
  const done = await app.workflows.wait(submitted.workflowId);
}
```

- `app.workflows` has `estimate`, `submit`, `get`, `watch`, `wait`, `cancel` and `list`. They go through the host's `/api/v1/blocks/workflows/*` routes, so the host prices, budgets and attributes the work. Every body kind those routes accept works, `kind: 'workflow'` included. It needs the block token and the `ai:write:budgeted` scope.
- It is a different client from `app.orchestration`, which calls the orchestrator directly with an OAuth access token and still refuses a block token. Its refusal message now names `app.workflows`.
- A refusal is an answer, not a throw. When the host declines to price or run a body it replies with a snapshot whose `status` is `'failed'`, with `error`, often an `errorCode`, and for a budget refusal the `cost.total` it would not charge. Every call resolves with that snapshot. A call rejects only when the request itself was refused (`ApiError`, with the HTTP status) or a reply carried no snapshot (`CivitaiError`).
- `submit` requires an `idempotencyKey` and rejects before sending without one. Mint it once per viewer action and reuse it on every retry. `submit` does not retry a failed request on its own.
- `watch` and `wait` hold each read on the host, space their reads, wait out a brief outage and stop on a refusal. Pass a `signal` to stop early.
- The contract types are exported from the package root: `WorkflowBody` and its members (`WorkflowBodyWorkflow`, `WorkflowBodyWorkflowStep`, `WorkflowStepRef`, `WithWorkflowStepRefs`, `WorkflowBodyTextToImage`, …), `BlockWorkflowSnapshot`, `KnownBlockWorkflowErrorCode` and `AppWorkflow`. They are a generated copy of the types `@civitai/app-sdk/blocks` defines, kept identical by a check.

Nothing existing changed: `app.orchestration`, `app.site`, `app.storage` and `app.sharedStorage` behave as before.

**`@civitai/app-sdk`, `@civitai/blocks-react`: README only.** Each README now opens with a short note on which package to start from: `@civitai/sdk` is the client new block apps start on, `@civitai/app-sdk/blocks` is the body-type and message contract, and `@civitai/blocks-react` is the React hook binding over the same host contract. All three remain supported. No code changed in either package.
