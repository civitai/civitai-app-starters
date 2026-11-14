---
'@civitai/components-chat': patch
---

Dictation works again on the orchestrator's `/mcp/v2`, the server the chat connects to. `/mcp/v2` has no `transcribe_audio` tool; it was removed in the discovery-first rewrite. Each recorded phrase now runs the `transcription` step through `run_step` with `whatif: false`, because `whatif` defaults to `true` there, which only prices the step. Its input is `{ mediaUrl, returnTimeStamps: false, language? }`. The words come from the step's `output.text`. A failed step rejects with the step's own error, and a recording with no audio track rejects with "The recording has no sound in it."

The built-in system prompt no longer tells the assistant to call `caption_media` or `transcribe_audio`, which `/mcp/v2` does not have. It now says the assistant cannot see images or hear audio, that captions it already knows are listed with the files, and that it should ask the user when a file has none. The README's dictation section and the `mcp.orchestration.exclude` note now say the same.
