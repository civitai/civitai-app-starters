---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

RELEASE HOLD: do not release this until civitai/civitai#5795 (branch `zach/app-blocks-workflow-kind`) is merged and deployed to civitai.com. A host that predates it refuses a `kind: 'workflow'` body, so `estimate()` and `submit()` reject for every app that sends one.

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

- **The body.** 1 to 8 steps (`BLOCK_WORKFLOW_MAX_STEPS`), each `{ name?, $type, input, suppressOutput? }`, plus optional `arguments`. A value anywhere in `input` may be a reference `{ $ref, path, default?, format? }`, where `$ref` is `'$arguments'`, an earlier step's `name`, or an earlier unnamed step by position (`'$0'`). A step cannot reference itself or a later step. A `name` matches `/^[a-z][a-z0-9_-]{0,31}$/`, is unique within the body and is not `block-step`. `suppressOutput: true` marks an intermediate step whose images are not surfaced. There is no `maxBuzz`: the ceiling is the app's per-generation budget × the number of steps, enforced by the host. Any orchestrator `$type` is accepted except the platform-internal ones (scanners, moderation classifiers, hashing, web scrape/search, and the retired `textToImage` step type).
- **`repeat` over `arguments` only, at most 16 iterations** (`BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS`, nested repeats multiplied). Its input is exactly `{ for: { $ref: '$arguments', path, as }, template: { $type, name?, input? } }`, `path` naming an array in `arguments`, nested at most 4 deep; the `as` name may not equal a step name. Repeat children appear in `snapshot.steps` as `<name>.<n>`. The single-step pass-through `kind: 'step'` arm now refuses `repeat` outright, since it has no `arguments` to iterate.
- **`merge`**: every `fields` entry needs a string `$ref` (`$arguments` or an earlier step, never a repeat variable) and a `reduce`; each counts toward the 64-reference cap.
- **Velocity**: the app's velocity limit counts one unit per step, and a `repeat` step one per iteration.
- 🔴 **The estimate is not a maximum.** The orchestrator re-prices a step once the values it references are known and charges the difference.
- **A workflow the host cannot price still proceeds**, reserved at the ceiling — except one containing a training step (refused without a quote, as on the single-step arm) or a `repeat` step at any depth (also refused without a quote, before any reservation, as `workflow_repeat_unbounded`).
- **One author fee per workflow**, on the quoted base, itemised as `cost.authorFee` on the estimate. If the workflow bills more, the fee charged is held to the fee shown; a workflow that does not succeed has its whole fee reversed, even if earlier steps delivered output.
- **`BlockWorkflowSnapshot.steps`** (optional): each step's `name`, `$type`, `status`, `imageUrls`, `output` and `error`. Top-level `imageUrls` is the union of the steps that did not set `suppressOutput`; `cost` stays workflow-level. 🔴 A `failed` snapshot can carry `cost.total > 0` and usable `imageUrls`, because steps that succeeded before the failing one stay charged.
- **Four new `errorCode` values** on `KnownBlockWorkflowErrorCode`: `workflow_step_denied`, `workflow_ref_invalid`, `workflow_too_many_steps`, `workflow_repeat_unbounded`.

`@civitai/app-sdk` adds the types `WorkflowBodyWorkflow`, `WorkflowBodyWorkflowStep`, `WorkflowStepRef`, `WithWorkflowStepRefs<T>` (a typed input with references allowed in it) and `BlockWorkflowStepSnapshot`, and the constants `BLOCK_WORKFLOW_MAX_STEPS` and `BLOCK_WORKFLOW_REPEAT_MAX_ITERATIONS`. Adding a member to `WorkflowBody` is a compile error for code that `switch`es exhaustively over `kind`; add a `'workflow'` case.

`@civitai/blocks-react`:

- The inbound validator accepts `snapshot.steps` and drops a snapshot whose `steps` is malformed or carries a step status outside the six workflow statuses.
- The mock host (`createMockHost` / `Harness`) estimates, submits and polls the kind. It prices each step with `generation.costPerGen` (a function now receives the step as a second argument, `MockWorkflowStepInfo`, exported from `/testing`) multiplied by a `repeat` step's iteration count, and adds `generation.authorFee` once. It refuses more than 8 steps; a bad step name or a malformed `repeat`; an unbounded `repeat`; a self, forward or unknown reference, a bad `merge` source or a repeat `as` name equal to a step name; and a platform-internal `$type` — with the four codes above and in that order, on estimate, batch estimate and submit. Polls report `steps`, finishing them in order, with `suppressOutput` honoured. The new `generation.failWorkflowStep` knob fails one named step so a partial failure can be tested. The spend-scope refusal applies to this kind as to every other. The mock checks where a reference points, not whether its `path` exists; it never re-prices and does not expand repeat children. `generation.workflowUnpriced: true` simulates a workflow the host could not quote: one with a training step is refused (`training-quote-unavailable`), one with a `repeat` at any depth is refused (`workflow_repeat_unbounded`), and any other is reserved at `buzzBudget` × steps with no fee.
