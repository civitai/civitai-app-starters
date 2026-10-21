---
'@civitai/components-chat': minor
---

A live reply now shows a status line under it from the moment it starts until it ends, with how long it has run: *Working · 0:42*. Before, the busy dots showed only before the first words and between a finished call and the next step, so a reply went blank, looking frozen, while the model wrote words or a long call it had not sent yet, and while a call whose own card shows nothing moving ran. The line reads *Reconnecting…* while the connection is down (a dropped model stream asked for again; with `runner="remote"`, the runner's event stream opened again) and *Still working on the server* for a server-runner reply the page found running when it opened the chat (a reload, another device), counting from when that run started. It is a polite `role="status"` that announces state changes, never the seconds.

New: `awaitingApproval` (attribute `awaiting-approval`) on `<civitai-chat>`. A page that asks the viewer to approve calls itself (a `beforeToolCall` that waits for a click, or approval cards it draws for a server runner's gate) sets it while a call waits, and the line reads *Waiting for your approval*.

`LiveTurn` (the agent's `live`) gains the optional `startedAt`, `reconnecting` and `reattached`.
