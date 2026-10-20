---
'@civitai/components-chat': minor
---

Experimental server runner: `<civitai-chat runner="remote">` with `remoteRunner = { url, headers, pageState }` runs each reply on a server that implements the new run protocol (`@civitai/components-chat/runner-protocol`), so a reply keeps going while the page sleeps or closes. The page follows the run's event stream into the same thread, tool views and subagent cards, reconnects with `Last-Event-ID` after a drop or a wake, finds a chat's live run again after a reload, and Stop asks the runner to stop. In remote mode the runner is the only writer of the saved conversation. The default stays `runner="browser"`, unchanged. New `@civitai/components-chat/core` entry: `AgentCore` and the rest of the reply loop with no DOM or Lit imports, for running it in Node.
