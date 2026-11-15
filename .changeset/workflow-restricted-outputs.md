---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

**A workflow snapshot tells you, per output, its rating or why you cannot have it.** The field is optional and additive. A host that predates it sends none, and the snapshot is unchanged.

- **`BlockWorkflowSnapshot.outputs?: BlockWorkflowOutput[]`**, also on `BlockWorkflowStepSnapshot` and `AppWorkflow`. It has one entry per available output, in order. Restricted, pending and blocked outputs keep their position. Each entry is exactly one of four shapes:
  - `{ url, nsfwLevel? }` (`BlockWorkflowAvailableOutput`): load it. `nsfwLevel` is `'pg' | 'pg13' | 'r' | 'x' | 'xxx'`. It is absent when there is no rating to report and none could restrict the output.
  - `{ restricted: true, reason }` (`BlockWorkflowRestrictedOutput`): no url and no rating. Show a locked state and do not try to fetch it; the host withholds it. The reasons:
    - `'pool'`: the Buzz that paid does not include mature content for this viewer, and the output is above PG-13.
    - `'ceiling'`: the output is above your app's maturity ceiling, above a cap the host put on the request, or blocked as mature content.
    - `'unrated'`: no rating will ever arrive (a training sample, a 3D model on a finished step with no rating source), and one could restrict it. It is terminal, and it does not set `ratingPending`. A video from an engine the orchestrator does not rate is **delivered** with its url while unrated, as on Civitai, because its provider moderates it; a rating that does arrive still meets the ceiling.
    - `reason` is an open union; treat an unknown value like `'ceiling'`.
  - `{ pending: true }` (`BlockWorkflowPendingOutput`): not rated yet, and its rating could still restrict it. There is no url and no `nsfwLevel` until the rating lands.
  - `{ blocked: true }` (`BlockWorkflowBlockedOutput`): blocked by moderation. It keeps its slot, has no url, and never becomes available.
- **`ratingPending?: true`** is set on the snapshot, each step and `AppWorkflow` while any output is `{ pending: true }`.
- **Only outputs you may load are in `imageUrls`**, `steps[].imageUrls`, `AppWorkflow.images` and `model3dOutputs`. Restricted, pending and blocked outputs are left out, so those lists can be shorter than `outputs`. Not-yet-available outputs are dropped from both, as before.
- **An index is a position in `outputs`.** `imageIndexes` (`publishGenerationOutputs`, `createPostFromApp`) and `imageIndex` (`persistGenerationSource`) name the output at that position. An index never moves when a rating or a block lands late, and naming an unusable position is refused rather than swapped for another output:
  - a restricted position: `output N is restricted`;
  - a pending position: `output N is still being rated, try again shortly`;
  - a blocked position: refused as not available.
  - With `imageIndexes` omitted, publish and post wait while any output is pending, and refuse when none is usable. `imageUrls` and `images` are convenience views, not for indexing.
- `@civitai/app-sdk` adds new types on `./blocks`: `BlockWorkflowOutput`, `BlockWorkflowAvailableOutput`, `BlockWorkflowRestrictedOutput`, `BlockWorkflowPendingOutput`, `BlockWorkflowBlockedOutput`, `KnownBlockWorkflowOutputRating` and `KnownBlockWorkflowRestrictionReason`. The pinned `./blocks` export count moves from 234 to 241. `@civitai/sdk` adds the same types on its root, from its generated copy of the workflow contract.
- `@civitai/blocks-react`: **a malformed `outputs` entry is replaced in place, not fatal.** `isValidWorkflowSnapshot` does not check `outputs`. The transport's `projectInboundPayload` replaces each malformed entry with the placeholder `{ restricted: true, reason: 'ceiling' }`, so no position moves, and removes the whole field only when it is not an array.
  - A restricted entry with a url, a pending or blocked entry with a url or rating, and an entry with two markers are all malformed.
  - A `ratingPending` that is not `true` is stripped.
  - This applies to every reply that carries a snapshot (top level and each step) and to `APP_WORKFLOWS_RESULT` / `CANCEL_APP_WORKFLOW_RESULT` rows.
  - `@civitai/sdk` does not validate replies.
- **`watch` after a final status:** in `@civitai/blocks-react` (`useBuzzWorkflow().watch`) and `@civitai/sdk` (`app.workflows.watch` / `wait`), a final snapshot with `ratingPending: true` does not end the watch.
  - It keeps polling at the usual pacing for up to two minutes, ending as soon as the flag clears. In blocks-react the window also ends at `timeoutMs`, whichever comes first.
  - When the window runs out it ends on the last snapshot, with outputs still pending.
  - Inside the window the run is already over. A transport failure, too many retries, a non-transient error, the deadline or an abort ends the watch on the last snapshot instead of rejecting, and the hook's status is `'done'`.
  - `onUpdate` fires as before.
- **Mock host:**
  - A succeeded snapshot carries `outputs` as the host sends it, with every output as `{ url }` (the mock rates nothing).
  - Options by 0-based position:
    - `generation.restrictedOutputs` (`{ 1: 'pool' }`);
    - `generation.pendingOutputs` (position → how many succeeded reads it stays held);
    - `generation.blockedOutputs`;
    - `generation.neverRatedOutputs` (reported as `{ restricted: true, reason: 'unrated' }`).
  - Each such position's url is left out of `imageUrls`, the step's `imageUrls` and `model3dOutputs`. Positions run across the steps of a `kind: 'workflow'` run.
  - Publish, post and persist naming an unusable position of a workflow the mock ran reply with the host's refusal, under the scenario the workflow ran under.
  - Publish and post with `imageIndexes` omitted are refused while any output is pending, as on the host, and publish is also refused when none is usable.
- ⚠️ **Migration risk for apps that indexed `images`.** An app that built `imageIndexes` from `AppWorkflow.images` or `imageUrls` positions (for example `images.map((_, i) => i)`) now names a different output whenever an earlier one is restricted, held or blocked. It is then refused, or publishes the wrong output. Build indexes from `outputs` positions, or omit `imageIndexes`. The `generate-studio` example now omits them.
