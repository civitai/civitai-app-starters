---
'@civitai/sdk': minor
---

`host.publishGenerationOutputs` — publish outputs of one of this app's own
workflows as public images, behind the host's confirmation. Resolves the ids of
the rows the host created. Needs `ai:write:budgeted`: an app trusted to spend
the viewer's Buzz on a generation is trusted to publish what that generation
produced.

🔴 **Outputs are named by INDEX, never by url, and that is the whole feature.**
The block sends `workflowId` plus `imageIndexes`; the host re-derives that this
viewer and this app own that workflow and resolves the orchestrator urls itself.
A shape that let a block name a url would let a frame at an opaque origin
publish an arbitrary blob under the viewer's account — a different, weaker
feature wearing this one's name. The payload is therefore built field by field
rather than spread from the caller's object, and the test asserts the wire's
exact key set rather than the absence of one spelling.

It waits on a person and nothing in this package cuts that short — the host
holds its confirmation until the viewer acts, and a `signal` is how a caller
bounds it. This is the same shape `openBuzzPurchase` already had; deadlines left
this package wholesale, so there is no protocol timeout for a human-gated
request to inherit.

Three differences from `@civitai/blocks-react`'s `usePublishGenerationOutputs`,
each for something the host does silently:

- **A missing `workflowId` is refused here.** The host DROPS a request it cannot
  read, with no reply at all, and with no client deadline that call never
  settles.
- **An unusable `imageIndexes` is refused here.** The host STRIPS a list it
  cannot read, and a stripped `imageIndexes` means publish EVERY output — so
  "publish these two" quietly becomes "publish all twenty", irreversibly.
- **`title` is gone.** It reached the host's validator and was discarded before
  the mutation, so sending it did nothing end to end.

A reply carrying neither ids nor a failure now rejects rather than resolving
`undefined` out of a promise typed `number[]` — `error: ''` is how the host
spells "no failure", so such a reply arrives as a success carrying nothing.

⚠ Publishing is best-effort per image, so `imageIds` can be SHORTER than the
selection and nothing says which index dropped. Compare lengths rather than
pairing ids to indexes.
