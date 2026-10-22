---
'@civitai/components-chat': minor
---

A reply step whose stream the network cut no longer pays for a second orchestration workflow when it is asked for again. The chat reads the step's workflow id from orchestration's `X-Civitai-Workflow-Id` response header and, before asking again, reads that workflow back: one that succeeded has its answer (words and tool calls) rebuilt with no new request, and what it cost counted on the reply, one still running is waited for (at most 10 minutes), and one that failed, has no answer, or is still running after that is canceled when still running before the step is asked for again. Stop (or any request given up on mid-answer) now cancels the step's workflow, so the model stops working on it. An orchestration without the header gets the old behaviour.

`createAssistantModel` takes a new, opt-in `recoverWorkflows: boolean` option (`<civitai-chat>` turns it on; other callers are unchanged).
