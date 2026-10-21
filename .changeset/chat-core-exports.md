---
'@civitai/components-chat': patch
---

Export MCP connection, result trimming and host-tool helpers from /core for server runners: `createMcpConnection` (with `McpConnectionClosedError`, `McpStreamLostError` and the connection types), `mcpResultToText`, `keepEnds`, `hostToolSet` (with its types), `MEDIA_NOTE` and `HOST_TOOL_FAILED_NOTE`.
