---
'@civitai/app-sdk': minor
'@civitai/sdk': minor
'@civitai/blocks-react': patch
---

**Two new `BlockWorkflowSnapshot.errorCode` values for prompt refusals, on every generation kind.**

- 🔴 **RELEASE HOLD: release after the civitai host change that returns these codes (civitai/civitai#9024) is live.** Until then a refusal still arrives as a failed snapshot with only `error`.
- `'prompt-policy-refused'`: the site's prompt check refused the prompt. Nothing was charged. `error` is the refusal reasons (`Your prompt was flagged: …`). Show it and stop: don't resubmit the same prompt, and don't retry it on another model.
- `'prompt-check-unavailable'`: the prompt check could not run. Nothing was submitted or charged. Retry no sooner than 30 seconds later, at most 3 times.
- Both come back from the submit as `{ workflowId: 'failed', status: 'failed', error, errorCode }`, over the bridge and from `POST /api/v1/blocks/workflows/submit` (a `200`, where a refusal used to be a `400`).
- `@civitai/blocks-react`: `RunConfirmedStepError.refused` and `RunTrainingError.refused` now document that a prompt refusal arrives the same way, with the code on `.snapshot.errorCode`.
- `@civitai/sdk`: the REST workflow types are regenerated with the two codes.
