---
'@civitai/components-chat': minor
---

**A chat on a host's own `backend` shows the examples its page sets with `examples`.** Clicking one puts its `prompt` in the message box, as on any other chat; that chat takes no files, so `wantsFile` opens no picker there. With `examples` unset it still shows none, and never the built-in ones (making a picture, a song…), and an empty list shows none. The greeting stays plain: no Buzz fine print, the same heading and user name as before. A chat without a `backend` is unchanged.
