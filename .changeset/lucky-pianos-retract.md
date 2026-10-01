---
"@civitai/blocks-react": patch
---

docs(useCheckpointPicker): retract the README's "currently **required**" clause — it contradicts the package's own shipped type

`useCheckpointPicker`'s README section described the pre-`0.59.0` world and was
never updated when `baseModelGroup` became optional. Two divergences from the
JSDoc, which is correct and ships in the `.d.ts`:

1. It asserted *"The parameter is currently **required** by this hook's type"*.
   `dist/hooks/useCheckpointPicker.d.ts` declares `baseModelGroup?: string`, and
   the same JSDoc opens with `🔴 OMIT THIS BY DEFAULT`. The README's claim was
   simply false as published.
2. More consequentially, the README **never told the reader the key could be
   omitted at all**. Its closing clause read *"pass a family derived from a real
   checkpoint, and never `''`"* where the JSDoc reads *"omit the key, or pass a
   family derived from a real checkpoint"* — so the one piece of advice the
   optionality change exists to deliver was missing, and the section read as
   derive-it-always.

Why it matters beyond this package: `civitai-developer-docs` generates the public
hooks reference from this README, not from the `.d.ts`, so both defects were
published to developer.civitai.com the moment its pin reached `0.61.0`
(civitai-developer-docs#136). The sibling `useResourcePicker` section was already
correct — *"Pass NO `baseModelGroup` by default"* — which is why only the
checkpoint hook was affected and why nothing flagged it.

The paragraph is now the JSDoc's substance: omit by default, pass it only to stay
inside a family the block already holds, and derive it from a real checkpoint when
you do.

No behaviour change — prose only. A patch release is needed because the published
README *is* the artifact the docs pipeline reads.
