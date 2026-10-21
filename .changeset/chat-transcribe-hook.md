---
'@civitai/components-chat': minor
---

A host `backend` can bring its own speech-to-text: `backend.transcribe(audio, { language, signal })` resolving to `{ text }` (types `ChatTranscribe`, `ChatTranscribeOptions` and `ChatTranscription`, on both `ChatBackend` and `ChatStoreBackend`). With it, `<civitai-chat>` offers the microphone on a backend, in `runner="browser"` and `runner="remote"` alike: the viewer records, sees the level, stops to edit or sends, and each recorded phrase goes to `transcribe` with the language chosen beside the microphone; cancelling aborts `signal`. Words are not streamed live, and the spoken conversation (`voice-conversation`) stays off on a backend. Without `transcribe` a backend still has no microphone, and a chat on Civitai dictates as before. `<civitai-chat-composer>` gains `hostVoice` (`host-voice`), which records phrases only and shows no Buzz price.
