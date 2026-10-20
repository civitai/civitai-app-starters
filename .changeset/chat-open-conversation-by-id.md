---
'@civitai/components-chat': minor
---

Deep-linking a conversation: `<civitai-chat conversation-id="…">` (property `conversationId`) opens a saved conversation by its id, with the orchestrator store, a host's store, and with the server runner on either (a chat whose reply is still running is followed again). An id with nothing saved under it, or one the store cannot read, shows "Could not open that chat." and leaves the open chat, and any reply running in it, as they are. Opening a chat saves nothing. `chat-change` now carries `saved` (`{ chatId, saved }`), and fires once more when a new chat's first save lands, so a page writes only a saved chat's id into its URL and a reload never asks for a chat that does not exist yet. Stores' `open(id, { existing: true })` rejects with a `not-found` error instead of opening an empty chat, and stores have `isSaved(id)` and a `saved-change` event.

A host backend's new `newChatModel` option, on a backend with a gateway and on a store-only backend: the model a new chat starts on (say, the viewer's last pick), when it is one of `models`. A saved chat keeps its own model, and one saved without a model keeps following `model`. New `model-change` event (`ModelChangeDetail`: `{ chatId, model }`) when the viewer changes the open chat's model.
