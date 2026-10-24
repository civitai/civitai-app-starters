---
'@civitai/sdk': minor
---

Add `estimatedCost(snapshot)`: the price an `app.workflows.estimate()` reply quotes, in whole Buzz, or `null` when it quotes none. An estimate is priced when its `status` is not `'failed'` and it carries a numeric `cost.total` — a priced estimate is not `'succeeded'` (it is `'pending'` in practice), so a check for `'succeeded'` reads every price as missing. `0` is a price; a `'failed'` snapshot carrying the cost it refused is not. The `estimate` doc comment and the README examples now price with it.
