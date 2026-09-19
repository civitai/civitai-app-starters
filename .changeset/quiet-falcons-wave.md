---
'@civitai/components-react': minor
---

`<civitai-image>` is bindable: `onImageLoad` and `onImageError`. They are not
called `onLoad`/`onError` because React wires those itself on any host element,
so sharing the name would run the handler twice.

`onSelect` on `CivitaiMenu` is typed with `MenuSelectDetail` now that the event
carries a value rather than a DOM node.

Which elements get `onChange`/`onInvalid` is read off the field base rather than
listed by hand, so a control that joins that base cannot silently miss them —
which is exactly what happened to the checkbox, radio group and segmented
control in this release.
