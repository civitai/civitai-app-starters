---
'@civitai/components-chat': patch
---

**`<civitai-chat>` fits a phone-width host again.** The main column was an implicit grid track, which sizes to its widest content rather than to the chat, so a long chat title widened the whole chat past the screen: the New chat button, the Send button and the right edge of every message landed off-screen (a 359px chat laid out 427px wide on an iPhone 15; on an iPhone SE even a short title overflowed by 15px). The column is now bounded to the chat's width, and a long title truncates instead.
