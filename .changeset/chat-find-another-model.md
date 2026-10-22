---
'@civitai/components-chat': minor
---

A panel's model list can grow past what it offered. A panel with a `model` choice (every **Adjust** panel) ends that choice with **Find another model…**, which starts the request in the message box for the viewer to finish and send; model cards from a search get **Generate with**, which asks it to add that model (by AIR) and select it, instead of only linking to the site. `update_panel` gains `addOptions` (`{ "<input>": { "<label>": settings } }`), which adds choice options and keeps the existing ones, and the panel context shows the settings behind each choice's selected option so the assistant can copy them with the new model swapped in. Before, asked to add a model, the assistant could only replace the whole choice and said it had added one when the list was unchanged. `<civitai-chat-model-card>` gains `action` and the `model-use` event.

A LoRA goes on top of the picked model instead of standing in for one: a panel's run input can spread blocks of settings in turn (`"input": {"...": ["{{model}}", "{{lora}}"]}`), so a **LoRA** choice (with **None**) applies to whichever model is selected, and the assistant is told to set panels up that way.
