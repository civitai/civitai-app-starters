---
'@civitai/components-chat': minor
---

The assistant can change its own standing instructions when the viewer asks it to behave differently from now on (a personality, a tone, a name, something to always do or avoid). Its `update_instructions` tool proposes the complete new text on a card, where the viewer can edit it; **Save** writes it to Settings → Custom instructions, used in every chat from the next reply, and **Not now** leaves them as they were. Nothing changes without Save, so text the assistant reads elsewhere cannot rewrite its instructions on its own. The card stays saveable after later replies until it is saved or put aside; one already saved reads as saved.
