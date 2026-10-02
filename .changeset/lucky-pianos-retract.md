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

3. 🔴 **And the EXAMPLE, which an adversarial audit caught after the prose was
   already fixed — the half that matters most here.** The section's sole example
   unconditionally passed `baseModelGroup: context.checkpoint.baseModel` under the
   comment *"Derive the family … never a literal"*, which is precisely the trap the
   `.d.ts` names: *"Passing the family you are already in … makes the picker offer
   only the ecosystem the user is trying to leave, and every other family becomes
   unreachable for the life of the session."* Correcting the prose while leaving
   that example in place would have fixed the sentence a reader skims and kept the
   code they copy. The README now mirrors the `.d.ts`'s two-example structure: the
   unconstrained default FIRST, the derived form second and explicitly conditional.

   This matters more than the sentence because the arc that produced it concluded
   that **a weak model does not read API surface and infer a flow — it copies the
   nearest example.** The example was the artifact.

No behaviour change — prose and example only. A patch release is needed because the
published README *is* the artifact the docs pipeline reads.
