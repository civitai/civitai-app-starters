---
'@civitai/components-chat': patch
---

A panel choice's text may hold placeholders of its own (`"Calm": "a calm {{voice}} voice"`): they are filled in when it runs, and count as using that input. An input the run never uses is left out of the panel, with a note to the assistant, instead of refusing the panel. After three refused panel calls in one reply, the assistant is told to stop and tell the user instead of trying again.
