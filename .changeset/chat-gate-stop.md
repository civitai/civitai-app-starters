---
'@civitai/components-chat': minor
---

`beforeToolCall` can end the reply: `{ refuse, stop: true, message? }` refuses the call and asks the assistant nothing more in this reply, so a model that ignores a refusal can no longer keep making paid steps up to the step limit. The reply ends as done (not as an error) with `message` (or a default) and the same Continue button a reply that ran out of steps shows. Calls in the same step whose gate answers after the stop, and any later call in the reply, do not run; each is reported as a `tool-result` with `stopped: true`. A refusal without `stop` behaves as before, and Stop still stops the reply whatever the gate answers. The turn records the words as `assistant.stopped`.
