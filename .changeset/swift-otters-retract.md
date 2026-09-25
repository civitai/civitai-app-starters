---
'@civitai/app-sdk': patch
'@civitai/blocks-react': patch
---

Retract a false security claim about the `customComfy` inline arm.

`WorkflowBodyCustomComfyInline`'s doc comment, the `WorkflowBodyCustomComfy` and
`WorkflowBody` union summaries, the `useBuzzWorkflow` docstring and the app-sdk
README all said the inline arm was **app-developer-only** — that the host runs
`assertViewerIsAppDeveloper` on every `customComfy` estimate and submit, so a
non-developer viewer of a published block could not submit one.

That is false. Neither `customComfy` arm runs any app-developer check, on the
estimate or on the submit; the host's own schema module carries the same
retraction. The claim matters because it is a security claim: an author who
believes the platform gates the arm by developer status will ship an inline graph
to a surface every viewer of their published block can reach.

The replacement text names no audience. It enumerates the refusals the host
actually runs before either arm's body is inspected — page tokens only, the
`ai:write:budgeted` consent scope, a signed-in viewer whose token subject
resolves, the per-user Apps kill-switch, and (submit only) a positive per-call
Buzz budget minted from the app's own `page.buzzBudgetPerGen`, not from the
viewer. The related "a registered recipe is the way to reach every viewer" line
is corrected too: a recipe buys a reviewed graph, not a wider audience.

Docs only — no runtime behaviour changes. These doc comments and the README are
the source the generated `/apps/` reference on developer.civitai.com is built
from, which is why the correction has to land here.
