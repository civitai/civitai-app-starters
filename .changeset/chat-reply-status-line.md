---
'@civitai/components-chat': minor
---

A live reply now shows a status line under it from the moment it starts until it ends, with how long it has run: *Working · 0:42*. Before, the busy dots showed only before the first words and between a finished call and the next step, so a reply went blank, looking frozen, while the model wrote words or a long call it had not sent yet, and while a call whose own card shows nothing moving ran. The line reads *Reconnecting…* while the connection is down (a dropped model stream asked for again; with `runner="remote"`, the runner's event stream silent past a missed keep-alive (20 s) or opened again, or the runner asking its model again after a drop) and *Still working on the server* for a server-runner reply the page found running when it opened the chat (a reload, another device), counting from when that run started. Its polite `role="status"` region says each change of state once (the start is said once, by the thread), never the seconds. With `prefers-reduced-motion: reduce` its dots hold still.

New: `awaitingApproval` (attribute `awaiting-approval`) on `<civitai-chat>`. A page that asks the viewer to approve calls itself (a `beforeToolCall` that waits for a click, or approval cards it draws for a server runner's gate) sets it while a call waits, and the line reads *Waiting for your approval*. It goes back to `false` by itself when the reply it was set during ends, so a Stop while a call waited does not start the next reply on it.

`LiveTurn` (the agent's `live`) gains the optional `startedAt`, `reconnecting` and `reattached`.
