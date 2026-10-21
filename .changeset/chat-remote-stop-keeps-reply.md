---
'@civitai/components-chat': minor
---

Server runner (`runner="remote"`): a reply that ends on the page without the run saying so (the runner refused Stop, Stop's 10-second grace ran out, or the runner refused the viewer the reply's events) now keeps what it had shown, instead of going blank when the chat is read again; only a saved reply that finished, or holds more, replaces it. A chat the page left and came back to while its live-run lookup was on its way is now looked up again and followed. An event stream that ends its last event with a bare CR blank line delivers that event.

**Type change:** `ChatSubagentStatus` (a subagent result's `status`) gains `'unreceived'`: a subagent of such a reply whose result never reached the page (its card reads "Result not received"), with the new optional `changedCount` for a write subagent's files changed when last seen. A page that maps every status (e.g. a `Record<ChatSubagentStatus, string>`) needs an entry for it; this is a minor for that reason, as `'interrupted'` came in a minor (0.20.0).
