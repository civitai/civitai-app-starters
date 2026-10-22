---
'@civitai/components-chat': patch
---

`send()` no longer puts a message it cannot send now (the chat holds, or the Buzz grant is refused) into the empty message box while the viewer is `dictating`: the box is hidden behind the recording bar and their words are joined onto it, so the message landed glued to the front of what they said. Not dictating, it is kept in the empty box as before.
