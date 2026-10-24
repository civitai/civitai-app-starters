---
'@civitai/components-chat': minor
---

Edit the latest message. While no reply runs (after a reply finished, after Stop, after an error), the viewer's latest message shows **Edit**: Save replaces its words, drops the reply that followed it and asks for a reply afresh (a new reply, charged like one); Cancel leaves it as it was. Keyboard: Enter saves, Shift+Enter is a new line, Escape cancels and puts focus back on Edit. The chat is saved at once with the edited message and no reply. An edit fires `before-send` with `edit: true`. Remote mode: Edit shows only once the runner lists `features: ['edit']` on a start's or a lookup's answer; the runner protocol adds `turn.edit` on `StartRunRequest` and `features` on `StartRunResponse` and `RunLookupResponse` (both optional, so older runners and pages keep working).
