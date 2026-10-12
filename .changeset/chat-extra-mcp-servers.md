---
'@civitai/components-chat': minor
---

`<civitai-chat>` takes more MCP servers through a new `mcpServers` property (also `mcp().mcpServers` in `ChatSession`), for per-user servers whose address is known only at runtime. Each entry is `{ id, url, token?, label? }`; its tools join the assistant's as `${id}__${tool}`. A new array opens and closes servers without touching the conversation, and an equal one changes nothing. A server that cannot be reached adds no tools and shows a toast, and the chat carries on. Long calls restart their 610 s timeout on every progress notification, up to 30 minutes. Exports the `ChatMcpServer` type.
