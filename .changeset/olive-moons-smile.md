---
'@civitai/app-sdk': minor
'@civitai/blocks-react': patch
---

Make `WorkflowBodyCustomComfy` a discriminated union on `mode`, and delete the false "the iframe never sends a graph" claim.

The host has shipped an INLINE-GRAPH arm of `customComfy` (`mode: 'inline'`) — a block can ship the ComfyUI graph itself instead of naming a server-registered recipe. The SDK's type did not have it, and worse, its doc comment asserted the opposite: "there is no way for a block to run an arbitrary/unreviewed graph". That sentence was written when it was true and was never revisited. In a blind dogfood a developer working against the live feature read it, believed it over their own instinct, and concluded the capability did not exist.

`WorkflowBodyCustomComfy` is now `WorkflowBodyCustomComfyRecipe | WorkflowBodyCustomComfyInline`, mirroring the host's `blockCustomComfyMemberSchema`:

- `WorkflowBodyCustomComfyRecipe` — the existing shape, unchanged except that `mode` is now an OPTIONAL `'recipe'` literal. A body that omits `mode` still lands here, so every deployed block and every body written against an earlier SDK is byte-identical and keeps working. (The host declares it `.optional()` and specifically NOT `.default()` for this reason.)
- `WorkflowBodyCustomComfyInline` — `{ kind, mode: 'inline', workflow, resources, prompt?, negativePrompt?, maxBuzz }`, matching the host's `.strict()` `blockInlineComfyBodySchema` field-for-field. `InlineComfyNode` (`{ class_type, inputs }`) is exported alongside it.

The new doc comments describe what is actually enforced: the arm is developer-only and page-token-only; code review is replaced by three fail-closed server gates (AIR containment over the declared `resources`, an entitlement belt stricter than the onsite generator, and a moderation sweep over every string leaf in the graph); and `maxBuzz` is documented as what it really is — the host stamps `stepTimeoutSeconds = maxBuzz`, so it is simultaneously the Buzz ceiling and the step timeout in seconds, and setting it low to be thrifty buys a silently `expired` job rather than a cheap one.

The package README's type inventory now lists the new exports and explains the two arms, so the shipped npm page describes the same contract the types do — including that the inline arm is developer-only and page-token-only, and that a registered recipe is still how a graph reaches every viewer.

Wire parity is pinned against the HOST'S OWN fixtures rather than against our mental model of them: `test/blocks/inline-comfy-wire-parity.test-d.ts` transcribes the payloads from civitai's `workflow.schema.inline-comfy.test.ts` and asserts each body the host ACCEPTS satisfies these types, each field the host `.strict()`-REJECTS (`sessionOwnerApiToken`, `comfyImage`, `minVramGb`, `sessionId`, `useSageAttention`, `minimumDurationSeconds`, `trace`) stays unassignable, and the mode-less recipe body every deployed block sends still type-checks.

Additive for producers; narrowing for consumers that read `customComfy` fields without a second narrow on `mode` — which is the union doing its job. `@civitai/blocks-react`'s mockHost `preferredAccountType` is fixed accordingly (an inline body has no `params.accountType`; it resolves to Auto host-side, so `undefined` is the accurate answer). No runtime behaviour changes in either package.
