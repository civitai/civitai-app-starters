---
'@civitai/sdk': patch
---

`app.workflows.submit` docs (README and JSDoc): drop the claims that a submit naming a new quote is a new run and that the quote identifies a `kind: 'training'` run, neither of which held for a training body, and stop presenting `list()` as proof that a submit did not happen — a listed workflow carries no idempotency key.
