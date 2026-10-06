---
'@civitai/components-chat': minor
---

`<civitai-chat>` takes `commands`: a page adds its own slash commands (`{ usage, help, aliases?, run(arg, { send, compose, notify, conversationId }) }`), replaces a built-in by name or removes one with `null`, or builds the whole set from the built-ins with a function. Page commands show in suggestions, Tab completion and `/help`.
