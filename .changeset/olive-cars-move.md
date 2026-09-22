---
'@civitai/components': minor
---

Add `<civitai-checkbox>` and `<civitai-radio-group>`.

`<civitai-radio-group>` owns the whole set and renders its radios from a `data`
property, rather than coordinating slotted children the way the React binding
does. Native `name`-based exclusion is **tree-scoped**: radios in sibling shadow
roots never group, so two could be checked at once and arrow keys would not move
between them. Keeping them in one root keeps exclusion, roving focus and ARIA
native instead of reimplemented.

That means there is no standalone `<civitai-radio>` element. A lone radio that
cannot group with its siblings is a trap, and the group covers the real use.

`<civitai-checkbox>` submits its value only when checked, defaults that value to
`on`, and carries `indeterminate` — which is a property with no attribute on a
native checkbox, so it is set imperatively after each render.

Neither `checked` nor `indeterminate` is reflected. The `checked` ATTRIBUTE is
the default `form.reset()` returns to, exactly as on a native checkbox, so
writing live state back to it would make reset a no-op. This is the third
element where reflecting the value-ish property broke reset, and every
form-associated element now has a test pinning it.
