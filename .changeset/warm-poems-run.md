---
'@civitai/components': minor
---

Add `<civitai-tooltip>`, `<civitai-tabs>` and `<civitai-tab-panel>`.

All three render in the **light DOM**, which is the only way they can work.
`aria-describedby` and `aria-controls` are IDREFs, and an IDREF cannot cross a
shadow boundary — a bubble or a tablist rendered in a shadow root could never
reference a trigger or a panel the author put in the page. axe proved it when
`<civitai-segmented-control>` tried to carry a `tabs` mode; splitting them out
is what that finding forced.

Because there is no shadow root to render into, these are the only elements
here that are not Lit components. Their styles are injected into the document
once, scoped to the tag name so they cannot collide with the attribute CSS.

`<civitai-tooltip>` joins an existing `aria-describedby` rather than replacing
it, and Escape genuinely dismisses the bubble even while the pointer still
hovers or focus is still inside — the reveal is gated on the dismissal flag,
which clears on the next hover or focus.

`<civitai-tabs>` implements the roving tabindex: one tab stop, arrows wrapping
across enabled tabs, Home/End, and selection following focus. Only the selected
panel is shown; the rest are `hidden`, so they leave the a11y tree and the tab
order.
