---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

RELEASE HOLD: do not release this until the host change in civitai/civitai (branch `zach/app-blocks-workflow-kind`) is merged and deployed to civitai.com. A host that predates it refuses a `kind: 'workflow'` body, so `estimate()` and `submit()` reject for every app that sends one.

**A new `WorkflowBody` kind, `kind: 'workflow'`: several orchestrator steps submitted as one workflow, where a later step can consume an earlier step's result.**

```ts
const body: WorkflowBody = {
  kind: 'workflow',
  arguments: { prompt: 'a lighthouse at dusk' },
  steps: [
    {
      name: 'draw',
      $type: 'imageGen',
      input: { engine: 'google', model: 'nano-banana-2', prompt: { $ref: '$arguments', path: 'prompt' } },
      suppressOutput: true,
    },
    {
      name: 'cutout',
      $type: 'imageBackgroundRemoval',
      input: { image: { $ref: 'draw', path: 'output.images[0].url' } },
    },
  ],
};
```

It goes through the existing messages and hooks: `useBuzzWorkflow().estimate / submit / watch / cancel`, a `useBatchEstimate()` cell, and `useWorkflowBatch()`. There is no new bridge message and no new hook.

- **The body.** 1 to 8 steps (`BLOCK_WORKFLOW_MAX_STEPS`), each `{ name?, $type, input, suppressOutput? }`, plus optional `arguments`. A value anywhere in `input` may be a reference `{ $ref, path, default?, format? }`, where `$ref` is `'$arguments'`, an earlier step's `name`, or an earlier unnamed step by position (`'$0'`). A step cannot reference itself or a later step. A `name` matches `/^[a-z][a-z0-9_-]{0,31}$/`, is unique within the body and is not `block-step`. `suppressOutput: true` marks an intermediate step whose images are not surfaced. There is no `maxBuzz`: the ceiling is the app's per-generation budget × the number of steps, enforced by the host. Any orchestrator `$type` is accepted, `repeat` included, except the platform-internal ones (scanners, moderation classifiers, hashing, web scrape/search, and the retired `textToImage` step type).
- 🔴 **The estimate is not a maximum.** The orchestrator re-prices a step once the values it references are known and charges the difference.
- **A workflow the host cannot price still proceeds**, reserved at the ceiling.
- **One author fee per workflow**, itemised as `cost.authorFee` on the estimate.
- **`BlockWorkflowSnapshot.steps`** (optional): each step's `name`, `$type`, `status`, `imageUrls`, `output` and `error`. Top-level `imageUrls` is the union of the steps that did not set `suppressOutput`; `cost` stays workflow-level. 🔴 A `failed` snapshot can carry `cost.total > 0` and usable `imageUrls`, because steps that succeeded before the failing one stay charged.
- **Three new `errorCode` values** on `KnownBlockWorkflowErrorCode`: `workflow_step_denied`, `workflow_ref_invalid`, `workflow_too_many_steps`.

`@civitai/app-sdk` adds the types `WorkflowBodyWorkflow`, `WorkflowBodyWorkflowStep`, `WorkflowStepRef`, `WithWorkflowStepRefs<T>` (a typed input with references allowed in it) and `BlockWorkflowStepSnapshot`, and the constant `BLOCK_WORKFLOW_MAX_STEPS`. Adding a member to `WorkflowBody` is a compile error for code that `switch`es exhaustively over `kind`; add a `'workflow'` case.

`@civitai/blocks-react`:

- The inbound validator accepts `snapshot.steps` and drops a snapshot whose `steps` is malformed or carries a step status outside the six workflow statuses.
- The mock host (`createMockHost` / `Harness`) estimates, submits and polls the kind. It prices each step with `generation.costPerGen` (a function now receives the step as a second argument, `MockWorkflowStepInfo`, exported from `/testing`) and adds `generation.authorFee` once. It refuses more than 8 steps, a self, forward or unknown reference or a bad step name, and a platform-internal `$type`, with the three codes above and in that order, on estimate, batch estimate and submit. Polls report `steps`, finishing them in order, with `suppressOutput` honoured. The new `generation.failWorkflowStep` knob fails one named step so a partial failure can be tested. The spend-scope refusal applies to this kind as to every other. The mock checks where a reference points, not whether its `path` exists, and it never re-prices.
