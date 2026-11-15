---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
'@civitai/sdk': minor
---

`WorkflowBodyStep`, `WorkflowBodyPassThroughStep` and `WorkflowBodyWorkflow` take an optional `accountType` (`BuzzAccountType`): the Buzz pool the host tries first, with the app's other allowed pools as fallback, as a `textToImage` body already does. On a `kind: 'workflow'` body it is one pick for the whole workflow. A pool outside the app's allowed set is refused on the estimate and the submit; a pick does not guarantee an unrestricted output, since a fallback to `blue` can still restrict a mature one. **Release order: host first.** civitai/civitai must accept `accountType` on these bodies (civitai/civitai#8985) before any app sends it: a host without it refuses the whole body as an unknown key, so the estimate and the submit fail. Omitting the field works on every host. `createMockHost` reads the pick on these bodies (`spentAccountType` stamp, and a disallowed pool refused on the estimate, the submit and a confirmed run, the last before the quote is spent, with the host's message) and accepts it in its `kind: 'workflow'` wire check. `@civitai/sdk`'s copy of the workflow body types carries the same field.
