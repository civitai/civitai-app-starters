---
'@civitai/blocks-react': patch
---

Docs only: `useBuzzWorkflow` no longer tells you to open a Buzz top-up on a resolved `status: 'failed'` submit. Every resolving refusal is a cap that buying Buzz does not raise — the per-call `buzzBudget`, the viewer's daily and consent caps, the app's velocity and daily caps, the dev-session cap, a "temporarily unavailable" deny and a missing price quote. A viewer who is actually out of Buzz makes `submit` REJECT with `WorkflowSubmitError` code `'exception'`, the same code as any other thrown submit and with nothing structural marking it as insufficient funds, so decide a top-up from `useBuzzBalance()` against the quoted cost rather than from either outcome alone.
