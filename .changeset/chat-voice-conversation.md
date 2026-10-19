---
'@civitai/components-chat': minor
---

`<civitai-chat voice-conversation>` offers a hands-free spoken conversation: the viewer talks, each reply is read aloud as it streams, and talking over a reply stops it. An end-of-turn model decides when the viewer has finished, so a pause to think is not cut off. Nothing for it loads or is billed until the viewer starts one; the voice is set with `configureChat({ conversationVoice })`.
