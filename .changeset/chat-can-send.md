---
'@civitai/components-chat': minor
---

**`<civitai-chat>` says when a message can go: a read-only `canSend` property and a `can-send-change` event.** `canSend` is `true` when `send(text)` would send now: the chat has started, no reply is running, and nothing holds it (the page's `holdReason`, or an added MCP server still listing its tools). `can-send-change` fires with `{ canSend }` (type `CanSendChangeDetail`; it bubbles and is composed) once each time that changes, so a page holding a message of its own can send it the moment the chat can take it instead of calling `send()` again on a timer. See "When a message can go" in the README.
