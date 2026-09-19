---
'@civitai/components': minor
---

Add `<civitai-toast>` and `<civitai-toast-region>`, completing the element set.

`<civitai-toast-region>` owns the queue and the auto-dismiss timers, and renders
its toasts as its **own light-DOM children**. An `aria-live` region announces
nodes added to itself, so shadow content it rendered would not be announced.

Its API is imperative, like the React `useToast()` it replaces:
`region.show({ message, heading, color, duration, urgent })` returns an id;
`dismiss(id)` and `clear()` take it away. A `duration` of `0` is sticky. Timers
are cleared when the region is removed, so none fire against a detached element.

`<civitai-toast>` is the presentational card and carries its `role` on the host
— `status` normally, `alert` when urgent — because the role has to sit on the
element the live region actually sees appear.
