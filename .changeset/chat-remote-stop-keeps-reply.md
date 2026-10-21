---
'@civitai/components-chat': patch
---

Server runner (`runner="remote"`): a reply that ends on the page without the run saying so (the runner refused Stop, Stop's 10-second grace ran out, or the runner refused the viewer the reply's events) now keeps what it had shown, instead of going blank when the chat is read again; only a saved reply that finished, or holds more, replaces it. A chat the page left and came back to while its live-run lookup was on its way is now looked up again and followed. An event stream that ends its last event with a bare CR blank line delivers that event.
