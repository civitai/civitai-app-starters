---
'@civitai/sdk': patch
---

`app.workflows.submit` docs (README and JSDoc): drop the claim that a submit naming a new quote is a new run, which did not hold for a `kind: 'training'` body, and stop presenting `list()` as proof that a submit did not happen — a listed workflow carries no idempotency key.
