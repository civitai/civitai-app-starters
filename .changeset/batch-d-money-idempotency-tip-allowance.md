---
"@civitai/app-sdk": minor
"@civitai/blocks-react": minor
---

Batch D money slice: idempotency keys for the paid paths + a tip-allowance read.

- `useBuzzWorkflow().submit(body, { idempotencyKey? })` and the `SUBMIT_WORKFLOW`
  message now carry an OPTIONAL client idempotency key. The host threads it to the
  orchestrator dedupe so a lost-response / timeout retry collapses to ONE Buzz
  charge instead of double-charging. Omit it and each `submit()` mints a fresh key
  (today's behavior); pass a stable key (e.g. a grid-cell id) to make a retry safe.
- New `useTip()` hook — a REST wrapper for the block tip endpoint with the same
  optional `idempotencyKey` (a retry with the same key is collapsed server-side to
  the first result, so a timeout can't double-tip).
- New `useTipAllowance()` hook — reads the viewer's REAL remaining daily tip
  allowance `{ cap, spent, remaining }` (scope `social:tip:self`) so a block can
  show a genuinely-tracked ceiling instead of a dead client-side full-cap guess.

All additive/backward-compatible: an older host that ignores the new field simply
never dedupes; old-shape hook calls keep working unchanged.
