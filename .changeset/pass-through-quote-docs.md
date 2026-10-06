---
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
---

Docs: correct how the host bounds a pass-through step (`kind: 'step'`, bare
`$type`). It asks the orchestrator for a `whatif` quote on both `estimate` and
`submit`. When quoted, it reserves `max(maxBuzz, quote)` — gated against the
token's per-call budget, so it can exceed 250 — and stamps no step timeout;
`maxBuzz` is the step timeout only when there is no quote. `estimate` returns
that reservation, not a bare echo of `maxBuzz`. The `WorkflowBodyPassThroughStep`
and `trainedEpochs` docblocks, the README, the orchestrator step-catalog notes
and the mock host's `trainedEpochs` knob said otherwise. Docs only; no runtime
change.
