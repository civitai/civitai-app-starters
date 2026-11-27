---
'@civitai/components-chat': minor
---

**`@civitai/components-chat/core` exports `askChoiceTool()`, the chat's own `ask_choice` tool.** A server runner can now offer the same clickable-options tool the page offers, so the page and the runner share one definition. Same name (`ASK_CHOICE`), schema, description and results as before: `{ shown: true, awaitsUser: true }` ends the reply, and an input the card could not show returns an error so the model can call again. Also exported: the `AskChoiceInput` type and `normalizeChoice`, `CHOICE_MIN`, `CHOICE_MAX` and the `Choice` type. `<civitai-chat>` builds its `ask_choice` from the same factory, so nothing changes on the page.
