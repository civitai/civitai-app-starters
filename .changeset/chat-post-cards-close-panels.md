---
'@civitai/components-chat': minor
---

- A reopened chat brings back the post card for a picture a panel made. Panels are now restored before posts, so a post of a panel's run finds its picture; before, the card was silently left out.
- Panels can be closed: a × on the panel, and a `close_panel` tool for when the viewer asks the assistant. A closed panel folds to one line with **Reopen**, keeps what it made, stays closed after a reload, and is left out of what the assistant is told until it is changed or reopened. `update_panel` no longer has to stand in for closing, which only moved the panel down.
