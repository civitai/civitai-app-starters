---
'@civitai/components-chat': minor
---

`<civitai-chat>` gains `askAgain()`: it asks the viewer's latest message again, as it is, replacing the reply that followed it with a fresh one and never adding the message a second time. For a page whose own step stood in the reply's way (say the viewer had to free something up first) and that can now let the same request carry on, where `send(text)` would show the message twice. It goes as an edit does (`before-send` with `edit: true`) and resolves whether it went.

`configureChat({ modelsOnly: true })` offers only the page's `model` and `models`: the model button shows for every viewer (no Premium models setting), lists only those with each one's `note` as its cost hint, loads no other list and takes no typed id, and a chat saved with any other model replies with the default. A listed model's `note` now shows in the model list wherever its price is not known.
