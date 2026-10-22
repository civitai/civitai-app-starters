---
'@civitai/components-chat': minor
---

An added MCP server's `resultLimit` sets how much of each of its replies (and errors) the assistant gets: `{ head, tail }` keeps those counts from the start and end instead of 2,000 and 6,000, and `false` passes replies whole, for a server that caps its own. Unset, nothing changes. It applies on the element (`mcpServers`) and to a server runner using `McpServerPool` + `extraToolSet` from `./core`, which also exports `limitResult` and the `ChatMcpResultLimit` type. A zero `tail` now keeps nothing from the end, where `keepEnds` used to return the whole text.
