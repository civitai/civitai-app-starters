---
'@civitai/components': minor
---

`<civitai-modal>` answers `show()`, `hide()` and `toggle()`, the same three
`<civitai-menu>` already had. Setting `open` still works; this is only so the
two do not disagree about how a box is opened.

The README gains the four authoring rules an API review had to reconstruct:
when content is a property and when it is a slot, that parts are named after
the property that fills them, why no element needs `exportparts`, and that
visibility is a property with the methods as sugar.
