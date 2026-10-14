---
'@civitai/components-chat': minor
---

A reply that runs out of steps now says so and offers **Continue**, even when its last step says nothing; `configureChat({ maxSteps })` sets the budget (default 10, kept within 2 to 50). Tool-call syntax a model writes as text in that last step (GLM's `<tool_call>…`) is no longer shown. `ask_choice` reports a choice shown only when the card can show it (options sent as a JSON string that parses are accepted), and an unusable one goes back to the assistant to fix in the same reply instead of ending it. A failed reply keeps a trace of where it broke (stage, step, status, cause, request id), shown under Details and sent to the page as a `reply-error` event.
