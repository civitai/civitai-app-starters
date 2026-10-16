---
'@civitai/components-chat': minor
---

`<civitai-chat>` takes `examples` and `placeholder`, so a page whose chat does something other than make
media can offer its own starting points and message-box hint. Unset, the chat keeps the built-in
examples and hint; an empty `examples` list shows none. The `ChatExample` type is exported.

Signing in from a signed-out chat through a popup sign-in (by adding a file or pressing Sign in) now keeps what the viewer had in the
message box, such as an example's prompt, instead of starting the signed-in chat with an empty box.
