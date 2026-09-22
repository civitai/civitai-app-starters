---
'@civitai/components': minor
---

`<civitai-button>` takes `color` (`info | success | warning | error`), which
recolours every variant by rebinding the primary accent, and `href`, which
renders an anchor — navigation is a link whatever it looks like. A disabled
link drops its `href` rather than navigating while looking inert.

`<civitai-select>` refuses to shrink below its longest option; squeezed by a
crowded toolbar row it clipped its own value. `<civitai-table>` reaches the
button a sortable grid puts in its header, which inherits neither font nor
colour and had stopped the header treatment dead.
