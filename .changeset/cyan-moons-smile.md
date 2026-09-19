---
'@civitai/components': minor
---

Add `<civitai-image>` and `<civitai-slider>`.

`<civitai-image>` tracks `loading` / `loaded` / `error` and reflects it, so
`:host([status='error'])` and a consumer's own CSS can both see the state. It
reconciles from the element after render as well as from `load`/`error`, because
a cached image can already be `complete` before the listeners attach and fire
neither.

`status` is the reliable contract and the `load`/`error` events are the
convenience on top: a cached image settles immediately, so a consumer attaching
a listener after mount can miss the event entirely.

`<civitai-slider>` is a themed native range — arrow keys, Home/End and
`aria-valuenow` all come from the control rather than being reimplemented — with
the value read-out, description and error wired through the shared field base.

An unset range is not empty: the browser parks it at the midpoint of min/max.
The element now derives that before rendering, so its value, its read-out and
`FormData` agree with what is on screen instead of reporting `''`.
