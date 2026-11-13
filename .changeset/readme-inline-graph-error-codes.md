---
'@civitai/app-sdk': patch
'@civitai/sdk': patch
'@civitai/blocks-react': patch
---

Document the generation refusals a host sends that had no README row, and declare the inline-graph ones.

- `KnownBlockWorkflowErrorCode` gains `'inline-node-refused'` (an inline `customComfy` graph uses a node the host does not run inline; civitai#8488), `'not-api-format'` and `'model-filenames'` (the two `checkComfyGraph` codes the host also refuses an inline graph with). The host already sends all three; the field stays an open string, so keep a `default` branch.
- `@civitai/blocks-react` README: a new `errorCode` table under `useBuzzWorkflow()` for `'source-scan-pending'` (civitai#8405) and the three inline-graph codes, each with the host's `error` text and what to do.
