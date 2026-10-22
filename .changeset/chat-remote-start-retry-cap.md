---
'@civitai/components-chat': patch
---

Remote runner mode: a reply whose start keeps failing (no answer from the runner, or a 5xx, 408 or 429) is no longer asked again forever behind a spinner. It is asked again on the 1, 2, 5, 10, 30 s waits for at most a minute from the first ask (`START_GIVE_UP_MS`; six asks over 48 s when each fails fast), then the reply fails with the chat's usual error and Retry, which starts asking afresh. The start is stopped by its key in case an earlier ask did start a run. A 4xx refusal still fails at once.
