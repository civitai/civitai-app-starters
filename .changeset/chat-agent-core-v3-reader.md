---
'@civitai/components-chat': minor
---

Groundwork for replies that survive a sleeping or closed page. Nothing changes for a page today.

- **Reads v3 conversation heads.** v3 is v2 plus a reply saved while it was still running, with the steps it had finished. Such a reply opens as cut off, with those steps on screen and in the assistant's history, and is never asked for again by itself. This version still writes v2. A v2 reader leaves v3 heads out of its list, so this reader ships before any v3 writer. Heads of any other version are still left out.
- **Headless `AgentCore`.** The reply loop (steps, stop conditions, automatic retries of a dropped connection, the parts shown so far) moves out of `Agent` into `AgentCore`, which has no store, page or element. `Agent` keeps its surface and delegates to it. `agent.live` is now a read-only getter.
- **Experimental `runner` session option.** `'browser'` (the default) or `'remote'`. `'remote'` throws: it is not implemented yet. The element does not expose it yet.
