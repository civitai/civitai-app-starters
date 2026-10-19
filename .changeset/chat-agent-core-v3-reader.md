---
'@civitai/components-chat': minor
---

Groundwork for replies that survive a sleeping or closed page, and a reply still running in another tab no longer reads as cut off.

- **A reply still running elsewhere says so.** A reply that had not ended when the chat was last saved used to read "This reply was cut off. Ask again?", even while another tab or window was still running it, inviting a second run paid twice. Its save time now decides (the turn's start for v2, the latest step's save for v3). Under 5 minutes (`LIVE_REPLY_MS`) it shows "Still replying in another tab or window…" with nothing offered, and the chat reads itself again on view, on focus and as it passes 5 minutes. Past that, it is cut off as before.
- **Reads v3 conversation heads.** v3 is v2 plus a reply saved while it was still running, with the steps it had finished and the save's time. Gone (past 5 minutes) with finished steps whose every tool call has its result, it offers **Continue**, which carries on from those steps through Retry's path, so no tool in them runs again. This version still writes v2. A v2 reader leaves v3 heads out of its list, so this reader ships before any v3 writer. Heads of any other version are still left out.
- **Headless `AgentCore`.** The reply loop (steps, stop conditions, automatic retries of a dropped connection, the parts shown so far) moves out of `Agent` into `AgentCore`, which has no store, page or element. `Agent` keeps its surface and delegates to it. `agent.live` is now a read-only getter.
- **Experimental `runner` session option.** `'browser'` (the default) or `'remote'`. `'remote'` throws: it is not implemented yet. The element does not expose it yet.
