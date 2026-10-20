---
'@civitai/components-chat': minor
---

Deep-linking a conversation: `<civitai-chat conversation-id="…">` (property `conversationId`) and `open(id)` open a saved conversation by its id, with the orchestrator store, a host's store and the server runner (where a chat whose reply is still running is followed again). An id with nothing saved under it, or one the store cannot read, shows "Could not open that chat." and a new chat; `open(id)` resolves `false` then and never rejects. `chat-change` names the chat that is open, so a page can keep it in its URL. Opening a chat saves nothing. Stores' `open(id, { existing: true })` rejects with a `not-found` error instead of opening an empty chat.

A host backend's new `newChatModel` option: the model a new chat starts on (say, the viewer's last pick), when it is one of `models`. A saved chat keeps its own model, and one saved without a model keeps following `model`. New `model-change` event (`ModelChangeDetail`: `{ chatId, model }`) when the viewer changes the open chat's model.
