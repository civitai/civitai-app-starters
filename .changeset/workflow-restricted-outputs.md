---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**A workflow snapshot tells you, per output, its rating or that it is restricted.** The field is optional and additive. A host that predates it sends none, and the snapshot is unchanged.

- **`BlockWorkflowSnapshot.outputs?: BlockWorkflowOutput[]`**, also on `BlockWorkflowStepSnapshot` and `AppWorkflow`. It has one entry per available output, in order, with restricted outputs kept in position. An entry is either `{ url, nsfwLevel? }` (load it; `nsfwLevel` is `'pg' | 'pg13' | 'r' | 'x' | 'xxx'` and is absent while the output is unrated) or `{ restricted: true, reason }`. A restricted entry has **no url**. Show a locked state for it and do not try to fetch it; the host withholds it.
- `reason: 'pool'` means the Buzz that paid does not include mature content for this viewer, and the output is above PG-13. `reason: 'ceiling'` means the output is above your app's maturity ceiling (an SFW app), or above a cap the host put on the request. Both `reason` and `nsfwLevel` are open unions, typed as the known values plus any string.
- **A restricted output is not in `imageUrls`**, `steps[].imageUrls`, `AppWorkflow.images` or `model3dOutputs`. Those lists can now be shorter than `outputs`. Blocked and not-yet-available outputs are dropped from both, as before.
- **`imageIndexes`** (`publishGenerationOutputs`, `createPostFromApp`) index `AppWorkflow.images`, the same list as `imageUrls` with restricted outputs left out. They do not index `outputs`.
- `@civitai/app-sdk`: new types `BlockWorkflowOutput`, `BlockWorkflowAvailableOutput`, `BlockWorkflowRestrictedOutput`, `KnownBlockWorkflowOutputRating` and `KnownBlockWorkflowRestrictionReason` on `./blocks`. The pinned `./blocks` export count moves from 232 to 237. `@civitai/sdk` adds the same five types on its root, from its generated copy of the workflow contract.
- `@civitai/blocks-react`: **a malformed `outputs` entry is stripped, not fatal.** `isValidWorkflowSnapshot` does not check `outputs`. The transport's `projectInboundPayload` removes each malformed entry, or the whole field when it is not an array, and delivers the rest. This applies to every reply that carries a snapshot (top level and each step) and to `APP_WORKFLOWS_RESULT` / `CANCEL_APP_WORKFLOW_RESULT` rows. A restricted entry that carries a `url` or a rating is malformed and is removed whole. A later entry in that reply then moves up one position.
- **Mock host:** a succeeded snapshot now carries `outputs` as the host sends it, with every output as `{ url }` (the mock rates nothing). New option `generation.restrictedOutputs`, for example `{ 1: 'pool' }`, marks those 0-based positions as restricted. Their urls are left out of `imageUrls`, the step's `imageUrls` and `model3dOutputs`, and positions run across the steps of a `kind: 'workflow'` run. The option can be changed live through `setScenario`.
