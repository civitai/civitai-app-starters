---
'@civitai/components-chat': minor
---

`<civitai-chat>` can run on a host's own backend: set `chat.backend = { url, fetch, model, models, store }` and the chat starts without an `app`, sends replies to the host's OpenAI-compatible `/v1/chat/completions` through the host's `fetch`, and keeps conversations in the host's `ChatConversationStore` (`list`, `load`, `save`, `delete`). Everything that runs on Civitai's services (built-in MCP, generations and panels, uploads, voice, posting, Buzz and free replies, sign-in) is then off and hidden, and a gateway refusal shows the gateway's own message (`{ "error": { "message" } }` or plain text). Without `backend` nothing changes. See "Your own backend" in the README.
