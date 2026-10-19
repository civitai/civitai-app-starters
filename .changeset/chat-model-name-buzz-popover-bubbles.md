---
'@civitai/components-chat': minor
---

**The model button names the default model, the Buzz badge opens its breakdown, and the assistant's replies sit in a bubble that never widens the thread.**

- The model picker shows the default model by its name with a marker ("GPT-6 Luna · default"), never the bare word "Default": the page's label for that model, else OpenRouter's name, else its id made readable (`urn:air:…:org/Qwen3.8-27B@main.tar` → "Qwen3.8-27B"). A viewer who set their own default in Settings sees that model's name, marked the same way, and the Settings dialog's Assistant choice shows the default model's name with the marker too. Typing "default" or the default row's whole name picks that row, and `/model default` works as before. `buildModelList` now labels its `default` entry with the model's name (no longer `'Default'`); the marker is added where it is shown.
- The Buzz badge in the top bar ("≈ 12") is a button that opens the breakdown: the total, what was made, the assistant, and a line saying it is an estimate of the Buzz spent in this chat. It used to show this only in a hover tooltip, which a phone never shows. It opens on click, Enter or Space, has `aria-expanded` and `aria-controls`, closes on Escape with focus on the badge or in the breakdown (focus goes back to the badge; Escape elsewhere, such as in the message box, is left alone) or a click elsewhere, and is a 44px touch target. It still shows nothing at 0.
- The assistant's text sits in a left bubble on the surface colour; tool calls, cards and what it made stay outside it, and the viewer's bubble is unchanged.
- Fixed: a long reply (a code block, a long unbroken word or link) made the whole thread scroll sideways on a phone. A code block now scrolls inside itself and the rest wraps.
