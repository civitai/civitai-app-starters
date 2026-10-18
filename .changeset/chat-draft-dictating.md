---
'@civitai/components-chat': minor
---

**`<civitai-chat>` has two new read-only properties, `draft` and `dictating`, so a page can read the message box without reaching into the chat's shadow root.** `draft` is the text in the message box now (what the viewer typed, or what `compose()` or an example put there), `''` while the chat has no message box yet. `dictating` is `true` from the moment the viewer starts talking into the microphone until what they said has been added to `draft` (or sent, or thrown away): while recording, in the moment after they stop while the recorder hands over their last words, and while it is turned into text. Both work signed in and signed out. See "What is in the message box" in the README.
