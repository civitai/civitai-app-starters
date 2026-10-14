---
'@civitai/components-chat': minor
---

Host controls for `<civitai-chat>`:

- `mcp.orchestration` also takes `{ exclude: [...] }`, which keeps Civitai's tools on without the named ones, e.g. `{ exclude: ['run_step', 'run_workflow'] }` for a page where the assistant may look services up but never run (and charge for) one. The panels, which run through `run_step`, go with it; other per-call paid tools such as `transcribe_audio` stay unless listed too, and the microphone button transcribes on its own either way.
- `holdReason` (property or `hold-reason`): while set, nothing is sent to the assistant. The message box keeps what the viewer typed and shows the reason, and Stop still works. The chat also holds by itself while an added MCP server is still listing its tools.
- `beforeToolCall(name, input, { conversationId, signal })` is asked before every tool call, whether the tool is Civitai's, an added server's or the page's. `{ refuse }` stops the call before anything runs, and the assistant gets the reason as the tool's error; a hook that throws refuses too. `signal` aborts when the viewer stops the reply, which then stops at once and runs nothing, whether or not the hook answers. A `tool-result` event reports each finished call once (`name`, `input`, `output`, `isError`, `refused`).
- `/model` says which default new chats keep, and where it is changed, when the viewer has stored one.
