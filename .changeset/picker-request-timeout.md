---
'@civitai/blocks-react': patch
---

fix(pickers): give resource/checkpoint picker requests a human-interactive timeout

`useCheckpointPicker().open()` / `useResourcePicker().open()` used the default
~30s request timeout — but a picker waits for the USER to browse + choose, so a
slow pick rejected mid-flow with "request OPEN_*_PICKER timed out after 30000ms"
and the selection was lost. They now use a generous 10-minute bound (the host
still resolves earlier on pick/dismiss/close). Fake-timer regression test:
advancing 60s no longer rejects the open() promise.
