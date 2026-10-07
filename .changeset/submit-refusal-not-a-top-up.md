---
'@civitai/blocks-react': patch
---

Docs only: a resolved `status: 'failed'` submit is never a Buzz top-up cue. `useBuzzWorkflow`'s `submit` docs now hold the one complete list of what such a reply can mean: a spend cap or limit that refused the run before anything ran (the only case that may say "nothing was charged"), a training run the server could not confirm, or a real run that came back failed. The README, `useBuzzPurchase` and `useGoodPurchase` docs link to that list instead of restating it, and no longer call a cap refusal fixable by buying Buzz. A viewer who is actually out of Buzz makes `submit` REJECT with `WorkflowSubmitError` code `'exception'`, shared with other thrown submits, so decide a top-up from the viewer's spendable balance: `useBuzzBalance()` needs `buzz:read:self` (consent-gated; anonymous viewers are refused), and a block spends only blue plus its domain's pool, so compare that sum, not all three pools, against the quoted cost.
