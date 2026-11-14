---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

`WorkflowBodyStep`, `WorkflowBodyPassThroughStep` and `WorkflowBodyWorkflow` take an optional `accountType` (`BuzzAccountType`): the Buzz pool the host tries first, with the app's other allowed pools as fallback, as a `textToImage` body already does. On a `kind: 'workflow'` body it is one pick for the whole workflow. A pool outside the app's allowed set is refused on the estimate and the submit; a pick does not guarantee an unrestricted output, since a fallback to `blue` can still restrict a mature one. Needs civitai/civitai with the matching step schemas; an older host refuses the field as an unknown key. `createMockHost` reads the pick on these bodies (disallowed-pool rejection, `spentAccountType` stamp) and accepts it in its `kind: 'workflow'` wire check.
