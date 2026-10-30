---
'@civitai/components-chat': minor
---

A tool whose result says `reopenTools: true` makes the reply carry on with its tools built again, with no message from the viewer: for a tool that made something whose own tools the reply needs (say a new app whose server the page has just handed over). The step ends there and the same reply continues from its finished steps, at most three times a reply; a result that also says `awaitsUser` ends the reply as before. `AgentCoreRun.tools(progress?)` now gets the reply's finished messages when it is called again, so a server runner can build them for where the reply is.
