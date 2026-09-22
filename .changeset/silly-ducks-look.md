---
'@civitai/components': minor
---

Add `<civitai-textarea>`, `<civitai-number-input>` and `<civitai-select>`, on a
shared field base.

`CivitaiField` owns what every labelled control needs — ids, the
`aria-describedby` wiring, validity, `form.reset()` semantics and the value the
form sees — so each control spells out only itself. `<civitai-text-input>` moved
onto it with no change to its behaviour; its existing tests passed untouched.

`<civitai-number-input>` is a native `type="number"`, so the browser's spinners,
arrow-key stepping and `min`/`max`/`step` all work rather than being
reimplemented. `<civitai-textarea>` deliberately does NOT submit on Enter, since
Enter is a newline there.

`<civitai-textarea>` leaves `rows` at the native default of 2 rather than
`blocks-react`'s 3. The two existing surfaces disagree, and the contract this
element replaces is the attribute markup — picking 3 would resize every
migrating textarea.

`<civitai-select>` takes its options as a `data` property, since an attribute
cannot carry them, and renders a placeholder as a disabled empty first option.
