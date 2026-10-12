---
'@civitai/blocks-react': patch
'@civitai/app-sdk': patch
---

Docs only: the `useWorkflowBatch` README and two doc comments said each grid cell is submitted "with its own confirmation". The host shows no confirmation dialog for a submit; any confirm step is the app's own UI. No behaviour change.
