---
'@civitai/components-chat': minor
---

Once a model's free replies are used up, replies draw from a prepaid chat balance instead of the viewer's Buzz. The chat says when the free replies come back and offers to top up 100 Buzz, once or whenever the balance runs out. A badge in the top bar shows the free replies left and the balance, and tops it up. A free reply that is slow to start no longer switches to a paid one.

The Buzz spent in a chat now counts each reply at what it was charged, read from the orchestrator's closing usage (`stream_options.include_usage`, `usage.cost` in Buzz), so a free reply counts 0 and a premium model its real price. Replies saved before this keep the old estimate of 1 per call. Needs orchestrator v2.48.8 or later; older ones report the provider's USD cost there.
