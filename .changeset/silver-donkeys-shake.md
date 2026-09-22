---
'@civitai/components': minor
'@civitai/components-react': minor
---

Five elements a real consumer needed and the vocabulary had no answer for.

`<civitai-switch>` **extends** `<civitai-checkbox>` rather than restating it —
the payoff from folding every control onto one field base last release, since
the form participation, validity and error chrome all arrive for free and
`role="switch"` is the only difference that matters.

`<civitai-progress>` drops `aria-valuenow` entirely when `indeterminate`,
because a bar that does not know its extent should not claim one.
`<civitai-pagination>` keeps the first and last page either side of an ellipsis
so the buttons do not move under the pointer as you page, and emits `change`.
`<civitai-breadcrumb>` renders its separator as a pseudo-element, which is what
keeps it out of the trail a screen reader reads.

`<civitai-table>` is **light DOM on purpose**: a slotted `<tr>` inside a shadow
`<table>` leaves the table formatting context and stops being a row. It styles a
table the page already owns, so it works over a data grid's generated markup
instead of asking anyone to give up sorting and virtualization.

The CDN bundle budgets move to 32 kB and 38 kB gzip. No element is an outlier
to shave — an all-in-one bundle simply grows with the vocabulary, and a page
that counts bytes imports `@civitai/components/<tag>/define` instead.
