---
'@civitai/components-chat': patch
---

`<civitai-chat>` keeps recovering from network drops through a long reply. The retries a reply the browser's network cut off gets are now counted per drop, not per reply: a drop gets up to three retries, and the count starts again once a step finishes after a retry, so a reply of many minutes lives through several network changes; one reply still retries at most 10 times in all, so a network that keeps dropping ends it. The waits are now 1.5 s, 4 s and 8 s (were 500 ms and 2 s): a browser drops its connections twice about a second apart on one network change, and a retry inside that second failed at once and used up a try. `reply-retry`'s `attempt` counts the reply's retries.
