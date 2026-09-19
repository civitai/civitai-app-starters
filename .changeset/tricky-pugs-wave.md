---
'@civitai/theme': patch
---

Declare `color-scheme` alongside the tokens.

A dark surface with no `color-scheme` leaves the browser painting every NATIVE
control in light mode: a number input's spinner, a `<select>`'s disclosure
caret, checkbox and radio defaults, scrollbars and the text caret all render
pale against a dark background. It is not a token — it is the instruction that
makes the UA's own widgets match the surface they sit on.

Emitted in `:root` and `[data-theme='light']` as `light`, in
`[data-theme='dark']` as `dark`. It inherits, so it also reaches native
controls inside a shadow root, which is where the custom elements put theirs.

Nothing consumers wrote changes; existing attribute markup gets the same fix.
