---
'@civitai/components': minor
---

Add `<civitai-modal>` and `<civitai-collapse>`.

`<civitai-modal>` is built on native `<dialog>.showModal()`, so the focus trap,
the top layer, the inert background and focus restore all come from the
platform. The React binding it replaces documents the opposite — *"this does
NOT trap focus inside the panel — Tab can still reach content behind the
overlay"* — so this is a strict accessibility upgrade rather than a port.

It also sidesteps two risks the plan flagged: nothing is portalled to
`document.body` (the top layer needs no z-index or portal), and nothing reads
`document.activeElement` to restore focus, which returns the host rather than
the focused inner node.

Escape is honoured through the dialog's `cancel` event, so `close-on-escape`
turns it off by preventing the default rather than by swallowing the key.

Both elements name their label `heading`, not `title`: `title` is a global
attribute and would render a browser tooltip over the whole component.
