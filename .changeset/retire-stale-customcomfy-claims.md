---
'@civitai/blocks-react': patch
---

Retire the last "customComfy is recipe-only" claims — an app CAN ship its own
ComfyUI graph.

`WorkflowBodyCustomComfy` became a real discriminated union on `mode` in #215
(`@civitai/app-sdk` 0.32.0-to-be), so a block can carry the ComfyUI graph itself
(`mode: 'inline'`) instead of naming a server-registered recipe. That fix landed
on the TYPE and its doc comment. Three comments in `@civitai/blocks-react` went
on describing `customComfy` as a recipe-only `{ kind, recipe, params }` shape:

- `useBuzzWorkflow`'s JSDoc — the one a block author reads on hover — listed the
  `WorkflowBody` members as "a `customComfy` recipe body (`{ kind, recipe,
  params }`)". It now names both arms and says plainly that an app can ship its
  own graph.
- `createMockHost`'s docblock claimed the money path "drives BOTH `WorkflowBody`
  arms", naming two of three members and reducing `customComfy` to its recipe
  shape. It also asserted that "a customComfy body's preferred pool lives under
  `params.accountType`" — false for an inline body, which has no `accountType`
  at all, as `preferredAccountType` a thousand lines above already documents.
  The docblock contradicted the function.
- The `ESTIMATE_WORKFLOW` handler comment repeated "both WorkflowBody arms —
  `textToImage` AND `customComfy` ({ recipe, params })". The adjacent
  `SUBMIT_WORKFLOW` comment is corrected in the same pass.

Comments only — no runtime behaviour, no type, and no API changes. The reason it
is worth a release rather than a silent doc tidy is what the false version cost:
in a blind dogfood a developer working against the LIVE inline feature read the
equivalent claim, believed it over their own instinct, and concluded the
capability did not exist.

Adds `test/customComfy-doc-currency.test.ts`, which pins the two specific
regressions that happened — the recipe-only phrasings are absent, and each
docblock names the inline arm *within that docblock* rather than anywhere in the
file (a whole-file check passes on an unrelated mention a thousand lines away,
which is precisely how the stale block hid next to a correct one).
